// Zhihu OAuth: tokens live only in bounded server-side sessions, never in public API data.
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { parseOfficialJSON, assertOfficialSuccess, safeProfile, summarizeInterests } from "./personalization.mjs";
const PREFIX = "/api/auth/zhihu/", COOKIE = "echo_zhihu", PENDING_TTL = 5 * 60e3;
const methods = { status: "GET", login: "POST", logout: "POST", personalization: "POST" };
const same = (a, b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const failure = code => Object.assign(new Error(code), { code });
const positive = (value, fallback, max) => value === undefined ? fallback : /^\d+$/.test(value) ? Math.min(Number(value), max) : 0;
function registered(raw) {
  try { const u = new URL(raw); const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.pathname !== "/auth/callback" || host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127\.|^10\.|^192\.168\.|^0\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
    return u;
  } catch { return null; }
}
export function createOAuth({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000 } = {}) {
  const redirect = registered(env.ZHIHU_OAUTH_REDIRECT_URI);
  const appId = env.ZHIHU_OAUTH_APP_ID?.trim(), appKey = env.ZHIHU_OAUTH_APP_KEY?.trim(), secret = env.ZHIHU_ACCESS_SECRET?.trim();
  const configured = Boolean(redirect && /^\d+$/.test(appId || "") && appKey);
  const personalEnabled = env.ZHIHU_PERSONALIZATION_ENABLED === "true" && Boolean(secret);
  const sessions = new Map(), starts = new Map(), hashKey = randomBytes(32);
  const maxRequests = positive(env.ZHIHU_OAUTH_MAX_REQUESTS, 200, 10000);
  let spent = 0, concurrent = 0;
  function sweep() {
    for (const [id, s] of sessions) if (s.expires <= now()) { s.token = null; sessions.delete(id); }
    for (const [id, entry] of starts) if (entry.until <= now()) starts.delete(id);
  }
  function get(req) {
    const cookie = String(req.headers?.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
    return cookie && /^[a-f0-9]{48}$/.test(cookie) ? sessions.get(cookie) : undefined;
  }
  function setCookie(res, value, seconds = 28800) { res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`); }
  function invalidate(s) { if (s) { s.token = null; s.guidance = null; sessions.delete(s.id); } }
  function active(s) { return Boolean(s?.token && sessions.get(s.id) === s && s.expires > now()); }
  function allocate(res, fields) {
    const s = { id: randomBytes(24).toString("hex"), ...fields };
    sessions.set(s.id, s); setCookie(res, s.id); return s;
  }
  function summary(s) {
    const authenticated = active(s);
    return { configured, authenticated, expiresInMs: authenticated ? Math.max(0, s.expires - now()) : 0, profile: authenticated ? s.profile : null, mode: authenticated ? "authorized" : "public",
      personalized: authenticated && s.guidance?.source === "authorized-context", personalizationAvailable: authenticated && personalEnabled,
      guidance: authenticated ? s.guidance || null : null, reason: !configured ? "not_configured" : authenticated ? "authenticated" : "authorization_pending", quotaMode: "shared" };
  }
  async function official(url, options = {}) {
    if (spent >= maxRequests) throw failure("request_limit");
    if (concurrent >= 3) throw failure("busy");
    spent++; concurrent++;
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(url, { ...options, redirect: "error", signal: ctrl.signal });
      if (!r.ok || Number(r.headers.get("content-length") || 0) > 256 * 1024) {
        await r.body?.cancel();
        throw failure(r.status === 401 || r.status === 403 ? "auth_expired" : "upstream_failed");
      }
      const reader = r.body.getReader(), chunks = []; let bytes = 0;
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length;
        if (bytes > 256 * 1024) { await reader.cancel(); throw failure("upstream_failed"); } chunks.push(Buffer.from(value));
      } } finally { reader.releaseLock(); }
      return parseOfficialJSON(Buffer.concat(chunks).toString("utf8"));
    } finally { clearTimeout(timer); concurrent--; }
  }
  async function personalize(s) {
    const definitions = [ ["contents", { ContentType: "all", Offset: "0" }], ["followees", { Offset: "0" }], ["favlists", {}], ["favlist_contents", {}], ["collections", {}] ];
    const items = [], checks = []; let favlist;
    for (const [name, params] of definitions) {
      if (!active(s)) throw failure("auth_expired");
      if (name === "favlist_contents" && !favlist) { checks.push({ name, status: "skipped", reason: "no_public_favlist" }); continue; }
      try {
        const q = new URLSearchParams({ ...params, Limit: "1", ...(name === "favlist_contents" ? { FavlistUrlToken: favlist } : {}) });
        const data = await official(`https://developer.zhihu.com/api/v1/user/${name}?${q}`, { headers: {
          Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${secret}`, "X-OAuth-Token": s.token,
          "X-Request-Timestamp": String(Math.floor(now() / 1000)),
        } });
        if (data?.Code === 20001) throw failure("auth_expired");
        if (data?.Code !== 0 || !Array.isArray(data?.Data?.Items)) throw failure("upstream_failed");
        if (!active(s)) throw failure("auth_expired");
        const item = data.Data.Items[0];
        if (item && typeof item === "object") {
          items.push(item);
          if (name === "favlists" && /^[1-9]\d{0,19}$/.test(String(item.UrlToken))) favlist = String(item.UrlToken);
        }
        checks.push({ name, status: item ? "success" : "empty" });
      } catch (e) {
        if (e.code === "auth_expired") { invalidate(s); throw e; }
        checks.push({ name, status: "error", reason: e.code === "request_limit" ? "request_limit" : "upstream_failed" });
      }
    }
    if (!active(s)) throw failure("auth_expired");
    s.guidance = summarizeInterests(items, checks); // Raw items go out of scope; only coarse topics are retained.
    return s.guidance;
  }
  async function handle(req, res) {
    const u = new URL(req.url, "http://localhost"), callback = u.pathname === "/auth/callback";
    if (!callback && !u.pathname.startsWith(PREFIX)) return false;
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("X-Content-Type-Options", "nosniff");
    const json = (code, value) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(value)); };
    const back = reason => { res.writeHead(303, { Location: "/?zhihu=" + reason }); res.end(); };
    sweep(); let s = get(req);
    if (callback) {
      if (req.method !== "GET") { res.setHeader("Allow", "GET"); json(405, { error: "method_not_allowed" }); return true; }
      if (!configured) { back("not_configured"); return true; }
      const states = u.searchParams.getAll("state"), codes = [...u.searchParams.getAll("authorization_code"), ...u.searchParams.getAll("code")];
      if (!s?.state || states.length !== 1 || !same(states[0], s.state)) { if (s?.state) invalidate(s); back("state_invalid"); return true; }
      const deadline = s.expires; s.state = null; // Claim once, synchronously, before any upstream await.
      if (u.searchParams.has("error")) { invalidate(s); setCookie(res, "", 0); back("access_denied"); return true; }
      if (codes.length !== 1 || !codes[0] || codes[0].length > 2048) { invalidate(s); back("authorization_incomplete"); return true; }
      try {
        const tokenStartedAt = now();
        const tokenPayload = await official("https://openapi.zhihu.com/access_token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ app_id: appId, app_key: appKey, grant_type: "authorization_code", redirect_uri: redirect.href, code: codes[0] }).toString() });
        assertOfficialSuccess(tokenPayload);
        const token = tokenPayload?.data ?? tokenPayload?.Data ?? tokenPayload;
        if (typeof token?.access_token !== "string" || !token.access_token || token.access_token.length > 8192 || /[\r\n]/.test(token.access_token) || !Number.isFinite(Number(token.expires_in)) || Number(token.expires_in) <= 0) throw failure("upstream_failed");
        const expires = tokenStartedAt + Math.min(Number(token.expires_in) * 1000, 8 * 3600e3);
        if (expires <= now()) throw failure("auth_expired");
        const profile = safeProfile(await official("https://openapi.zhihu.com/user", { headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" } }));
        if (sessions.get(s.id) !== s || deadline <= now() || expires <= now()) throw failure("state_invalid");
        invalidate(s); allocate(res, { token: token.access_token, profile, expires, state: null });
        back("success");
      } catch { invalidate(s); setCookie(res, "", 0); back("upstream_failed"); }
      return true;
    }
    const action = u.pathname.slice(PREFIX.length), method = methods[action];
    if (!method) { json(404, { error: "authorization_unavailable", mode: "public" }); return true; }
    if (req.method !== method) { res.setHeader("Allow", method); json(405, { error: "method_not_allowed", mode: "public" }); return true; }
    if (method === "POST") {
      // Auth routes run before the game's request guards: enforce their own CSRF boundary.
      const expected = redirect?.origin;
      if (!expected || req.headers?.origin !== expected || req.headers?.host !== redirect.host || req.headers?.["sec-fetch-site"] === "cross-site") {
        if (!configured && action === "login") json(503, { ...summary(s), error: "authorization_unavailable" });
        else json(403, { error: "origin_invalid", mode: "public" });
        return true;
      }
    }
    if (action === "status") { json(200, summary(s)); return true; }
    if (action === "logout") { invalidate(s); setCookie(res, "", 0); json(200, { ok: true, mode: "public" }); return true; }
    if (action === "login") {
      if (!configured) { json(503, { ...summary(s), error: "authorization_unavailable" }); return true; }
      const ip = createHmac("sha256", hashKey).update(req.socket?.remoteAddress || "unknown").digest("hex");
      const entry = starts.get(ip) || { count: 0, until: now() + 60e3 };
      if (entry.count >= 5 || sessions.size >= 500 || starts.size >= 1000 || spent >= maxRequests) { json(429, { error: "request_limit" }); return true; }
      entry.count++; starts.set(ip, entry); invalidate(s);
      s = allocate(res, { state: randomBytes(32).toString("hex"), token: null, expires: now() + PENDING_TTL });
      const url = new URL("https://openapi.zhihu.com/authorize");
      url.search = new URLSearchParams({ app_id: appId, redirect_uri: redirect.href, response_type: "code", state: s.state }).toString();
      json(200, { url: url.href }); return true;
    }
    if (!active(s)) { json(401, { error: "login_required", mode: "public" }); return true; }
    if (!personalEnabled) { json(503, { error: "personalization_disabled", mode: "public" }); return true; }
    try {
      if (!s.guidance) { s.loading ||= personalize(s).finally(() => { s.loading = null; }); await s.loading; }
      if (!active(s)) throw failure("auth_expired");
      json(200, { guidance: s.guidance });
    } catch { json(401, { error: "auth_expired", mode: "public" }); }
    return true;
  }
  return { handle };
}
