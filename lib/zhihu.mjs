// Official contract: docs/official/zhihu-cli-0.7.2-beta.20260911131715/unpacked/zhihu/references/
// Public content is untrusted reference material, never the game's hidden truth.
import { budget, budgetMessage } from "./budget.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TTL = { hot: 30 * 60e3, search: 6 * 60 * 60e3, knowledge: 6 * 60 * 60e3 };
export const plainText = (s, max = 220) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max);
export function sourceUrl(raw) {
  try { const u = new URL(raw); return u.protocol === "https:" && (u.hostname === "zhihu.com" || u.hostname.endsWith(".zhihu.com")) ? u.href : ""; } catch { return ""; }
}
const digest = s => createHash("sha256").update(s).digest("hex").slice(0, 24);
const reason = code => ({ NO_SECRET: "未配置知乎 Access Secret", RATE_LOCAL: "本地频次保护", DAILY_LOCAL: "本地当日额度保护", EMPTY: "接口未返回可用内容", INVALID: "接口结构与文档不符", DISABLED: "活动知识接口已关闭", TIMEOUT: "知乎接口响应超时", UPSTREAM: "知乎接口暂不可用" }[code] || "知乎接口暂不可用");

// Factory isolates tests from real credentials, network and cache. Production endpoints are fixed.
export function createZhihuClient({ fetchImpl = globalThis.fetch, now = Date.now, secret = () => process.env.ZHIHU_ACCESS_SECRET || "", base = "https://developer.zhihu.com", knowledgeBase = "https://api.zhihu.com", cacheDir = process.env.ZHIHU_CACHE_DIR || path.join(ROOT, "data", "cache"), timeoutMs = 8000, knowledgeEnabled = () => process.env.ZHIHU_KNOWLEDGE_ENABLED !== "false", dailyLimits = { hot: 90, search: 900, zhida: 90, knowledge: 90 }, reserve = kind => budget.reserve(kind) } = {}) {
  const memory = new Map(), inFlight = new Map(), backoff = new Map(), history = {}, status = {};
  const configured = () => Boolean(secret());
  function allow(kind, consume = true) {
    const day = new Date(now() + 8 * 3600e3).toISOString().slice(0, 10), current = history[kind];
    if (!current || current.day !== day) history[kind] = { day, count: 0, times: [] };
    const h = history[kind]; h.times = h.times.filter(t => now() - t < 60e3);
    const cap = { hot: 4, search: 30, zhida: 10, knowledge: 10 }[kind];
    if (h.times.length >= cap) throw Object.assign(new Error(reason("RATE_LOCAL")), { code: "RATE_LOCAL" });
    if (h.count >= dailyLimits[kind]) throw Object.assign(new Error(reason("DAILY_LOCAL")), { code: "DAILY_LOCAL" });
    if (consume) { h.times.push(now()); h.count++; }
  }
  function keyOf(kind, query) { return digest(`v2:${base}:${knowledgeBase}:${kind}:${query}`); }
  async function cached(key) {
    if (memory.has(key)) return memory.get(key);
    if (cacheDir) try {
      const j = JSON.parse(await readFile(path.join(cacheDir, key + ".json"), "utf8"));
      if (j.version === 2 && Number.isFinite(j.at) && Array.isArray(j.items) && j.origin === "zhihu") { memory.set(key, j); return j; }
    } catch (e) { if (e.code !== "ENOENT") status.cacheWarning = "缓存不可读，已忽略"; }
    return null;
  }
  async function store(key, items) {
    const j = { version: 2, origin: "zhihu", at: now(), items }; memory.set(key, j);
    if (cacheDir) try { await mkdir(cacheDir, { recursive: true }); await writeFile(path.join(cacheDir, key + ".json"), JSON.stringify(j)); }
    catch { status.cacheWarning = "磁盘缓存不可写，当前使用内存缓存"; }
    return j;
  }
  async function getJSON(url, authenticated, kind) {
    if (authenticated && !configured()) throw Object.assign(new Error(reason("NO_SECRET")), { code: "NO_SECRET" });
    if (kind === "knowledge" && !knowledgeEnabled()) throw Object.assign(new Error(reason("DISABLED")), { code: "DISABLED" });
    allow(kind, false);
    const lease = reserve(kind);
    allow(kind);
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers = { Accept: "application/json", "Content-Type": "application/json" };
      if (authenticated) Object.assign(headers, { Authorization: `Bearer ${secret()}`, "X-Request-Timestamp": String(Math.floor(now() / 1000)) });
      const res = await fetchImpl(url, { headers, signal: ctrl.signal, redirect: "error" });
      if (!res.ok) throw Object.assign(new Error("知乎接口请求失败"), { code: `HTTP_${res.status}` });
      const j = await res.json();
      if (authenticated) { if (j.Code !== 0 || !j.Data) throw Object.assign(new Error("知乎业务响应异常"), { code: "UPSTREAM" }); return j.Data; }
      return j;
    } catch (e) { if (ctrl.signal.aborted) throw Object.assign(new Error(reason("TIMEOUT")), { code: "TIMEOUT" }); throw e; }
    finally { clearTimeout(timer); lease.release(); }
  }
  function envelope(kind, j, source, fallbackReason = null) {
    const r = { source, capability: kind, provider: "zhihu", fetchedAt: j ? new Date(j.at).toISOString() : null, stale: Boolean(j && now() - j.at >= TTL[kind]), fallbackReason, items: j?.items || [] };
    status[kind] = { source, fetchedAt: r.fetchedAt, stale: r.stale, fallbackReason }; return r;
  }
  async function load(kind, query, request, demoName) {
    const key = keyOf(kind, query);
    if (inFlight.has(key)) return inFlight.get(key);
    const task = (async () => {
      const previous = await cached(key);
      if (previous && now() - previous.at < TTL[kind]) return envelope(kind, previous, "cache");
      let code;
      try {
        const cooldown = backoff.get(key);
        if (cooldown && cooldown.until > now()) throw Object.assign(new Error("retry later"), { code: cooldown.code });
        const items = await request();
        if (!items.length) throw Object.assign(new Error(reason("EMPTY")), { code: "EMPTY" });
        backoff.delete(key); return envelope(kind, await store(key, items), "live");
      } catch (e) { code = String(e.code || "UPSTREAM"); if (!code.startsWith("BUDGET_") && (!backoff.has(key) || backoff.get(key).until <= now())) backoff.set(key, { code, until: now() + 60e3 }); }
      if (previous) return envelope(kind, previous, "cache", code);
      let items = [];
      if (demoName) try { const j = JSON.parse(await readFile(path.join(ROOT, "data", "demo", demoName + ".json"), "utf8")); items = j.items || []; } catch { status.demoWarning = "演示包不可读"; }
      const r = envelope(kind, null, kind === "knowledge" ? "unavailable" : "demo", code);
      r.items = items.map(i => ({ ...i, url: sourceUrl(i.url) })); r.error = code.startsWith("BUDGET_") ? budgetMessage(code) : reason(code); return r;
    })();
    inFlight.set(key, task);
    try { return await task; } finally { inFlight.delete(key); }
  }
  async function hotList(limit = 30) {
    const r = await load("hot", "30", async () => {
      const j = await getJSON(base + "/api/v1/content/hot_list?Limit=30", true, "hot");
      if (!Array.isArray(j.Items)) throw Object.assign(new Error("invalid"), { code: "INVALID" });
      return j.Items.filter(i => i.Title).map(i => ({ title: plainText(i.Title, 160), url: sourceUrl(i.Url), summary: plainText(i.Summary), thumb: "" }));
    }, "hot");
    return { ...r, items: r.items.slice(0, Math.min(30, Math.max(1, limit))) };
  }
  async function search(query, count = 8, demoName = null) {
    const q = plainText(query, 80);
    const r = await load("search", q, async () => {
      const url = new URL(base + "/api/v1/content/zhihu_search"); url.searchParams.set("Query", q); url.searchParams.set("Count", "10");
      const j = await getJSON(url.href, true, "search");
      if (!Array.isArray(j.Items)) throw Object.assign(new Error("invalid"), { code: "INVALID" });
      return j.Items.filter(i => i.Title).map(i => ({ title: plainText(i.Title, 160), type: i.ContentType, id: String(i.ContentID || digest(i.Title)), url: sourceUrl(i.Url), text: plainText(i.ContentText), author: plainText(i.AuthorName || "知乎用户", 60), badge: plainText(i.AuthorBadgeText, 80), votes: Number(i.VoteUpCount) || 0, comments: Number(i.CommentCount) || 0, authority: String(i.AuthorityLevel || ""), publishedAt: Number(i.EditTime) || null, picks: (i.CommentInfoList || []).slice(0, 2).map(c => plainText(c.Content, 100)) }));
    }, demoName && /^search_(leaving|third-try|colleague)$/.test(demoName) ? demoName : null);
    return { ...r, query: q, items: r.items.slice(0, Math.min(10, Math.max(1, count))) };
  }
  async function knowledgeList() {
    return load("knowledge", "list", async () => {
      const j = await getJSON(knowledgeBase + "/km-indep-home/hackathon/v2/knowledge/list", false, "knowledge");
      if (!Array.isArray(j)) throw Object.assign(new Error("invalid"), { code: "INVALID" });
      return j.filter(i => typeof i.work_id === "string" && /^[\w-]+$/.test(i.work_id) && i.title).slice(0, 40).map(i => ({ id: i.work_id, title: plainText(i.title, 160), text: plainText(i.description), author: "列表未提供作者", labels: (Array.isArray(i.labels) ? i.labels : []).map(x => plainText(x, 30)), url: knowledgeBase + "/km-indep-home/hackathon/v2/knowledge/list" }));
    });
  }
  async function zhidaChat(messages, { model = "zhida-fast-1p5", stream = false, signal } = {}) {
    if (!configured()) throw Object.assign(new Error(reason("NO_SECRET")), { code: "NO_SECRET" });
    // Direct-answer generation is not enabled under the new hard output budget until its
    // output-limit contract is verified. Do not silently bypass the common LLM protection.
    throw Object.assign(new Error(budgetMessage("BUDGET_PROVIDER")), { code: "BUDGET_PROVIDER" });
  }
  return { hotList, search, knowledgeList, zhidaChat, zhihuConfigured: configured, capabilityStatus: () => ({ credentialsConfigured: configured(), ...status }) };
}
const client = createZhihuClient();
export const { hotList, search, knowledgeList, zhidaChat, zhihuConfigured, capabilityStatus } = client;
export function matchHot(items, keywords) {
  const kws = String(keywords || "").split(/\s+/).filter(Boolean);
  let best = null, bestScore = 0;
  for (const it of items) { const hay = it.title + " " + (it.summary || ""); const score = kws.reduce((n, k) => n + (hay.includes(k) ? 1 : 0), 0); if (score > bestScore) { best = it; bestScore = score; } }
  return bestScore >= 1 ? { ...best, matched: bestScore } : null;
}
