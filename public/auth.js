// Browser receives only a random app-session cookie, sanitized identity and coarse suggestions.
export function authMessage(data) {
  if (!data || typeof data.configured !== "boolean") throw new Error("invalid_status");
  if (data.reason === "state_invalid") return "授权安全校验未通过，已回退到公共参考模式。请从本站重新发起；若平台未返回 state，需要平台确认支持后再登录。";
  if (["upstream_failed", "authorization_incomplete", "access_denied"].includes(data.reason)) return "授权未完成或服务暂不可用，已回退到公共参考模式。游戏进度保留，可以稍后重试。";
  if (!data.configured) return "OAuth 尚未配置完整，当前使用公共参考模式；无需登录也能完整游玩。";
  if (data.authenticated) return "已登录知乎。点击「生成个性化引导」才会读取少量授权资料；也可以直接继续游戏。";
  return "尚未获得知乎授权，当前使用公共参考模式。可前往知乎官方页面登录并亲自确认授权。";
}
export function authorizedRedirect(raw, origin) {
  const u = new URL(raw), callback = new URL(u.searchParams.get("redirect_uri"));
  if (u.origin !== "https://openapi.zhihu.com" || u.pathname !== "/authorize" || u.username || u.password || u.hash || callback.origin !== origin || callback.pathname !== "/auth/callback" || callback.search || callback.hash || !u.searchParams.get("state") || u.searchParams.get("response_type") !== "code") throw new Error("invalid_authorize_url");
  return u.href;
}
export function mountAuth(root = document, fetchImpl = fetch) {
  const $ = s => root.querySelector(s), entry = $("#zhihu-entry"), dialog = $("#zhihu-dialog");
  if (!entry || !dialog) return;
  const detail = $("#zhihu-auth-detail"), retry = $("#zhihu-retry"), login = $("#zhihu-login"), personalize = $("#zhihu-personalize"), logout = $("#zhihu-logout");
  let pending = false, state = null, callbackReason = null, generation = 0, loggingOut = false, expiryTimer;
  const params = new URL(location.href);
  if (["success", "state_invalid", "upstream_failed", "access_denied", "authorization_incomplete", "not_configured"].includes(params.searchParams.get("zhihu"))) {
    callbackReason = params.searchParams.get("zhihu"); params.searchParams.delete("zhihu"); history.replaceState(null, "", params.pathname + params.search + params.hash);
  }
  const signalModal = () => document.dispatchEvent(new CustomEvent("echo:auth-modal", { detail: { open: dialog.open } }));
  function open() { if (!dialog.open) { dialog.showModal(); dialog.scrollTop = 0; signalModal(); } }
  function renderGuidance(g) {
    const host = $("#zhihu-guidance"); host.replaceChildren(); host.hidden = !g;
    if (!g) return;
    const title = document.createElement("h3"); title.textContent = g.source === "authorized-context" ? "给你的选信与提问参考" : "这次先自由选信"; host.append(title);
    const p = document.createElement("p"); p.textContent = g.explanation; host.append(p);
    for (const r of (g.recommendations || []).slice(0, 3)) {
      if (!["leaving", "colleague", "third-try"].includes(r.letterId)) continue;
      const article = document.createElement("article"), b = document.createElement("b"), q = document.createElement("p");
      b.textContent = r.title; q.textContent = r.question; article.append(b, q); host.append(article);
    }
    const note = document.createElement("small");
    const counts = (g.checks || []).reduce((a, c) => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {});
    note.textContent = `资料检查：${counts.success || 0} 项有内容、${counts.empty || 0} 项为空、${counts.error || 0} 项不可用、${counts.skipped || 0} 项跳过。建议不改变故事与评分。`;
    host.append(note);
  }
  function expireSession() {
    generation++; callbackReason = null; display({ configured: state?.configured ?? true, authenticated: false });
    detail.textContent = "授权已到期，已清除身份与个性化资料。可重新登录，或继续公共模式。";
  }
  function display(data) {
    clearTimeout(expiryTimer);
    if (data.authenticated) {
      if (!Number.isFinite(data.expiresAt) || data.expiresAt <= performance.now()) { expireSession(); return; }
      expiryTimer = setTimeout(expireSession, data.expiresAt - performance.now());
    }
    state = data;
    detail.textContent = authMessage({ ...data, ...(callbackReason && callbackReason !== "success" ? { reason: callbackReason } : {}) });
    $("#zhihu-mode").textContent = data.authenticated ? "已登录知乎 · 个性化读取需主动开启" : "当前使用公共参考模式";
    $("#zhihu-auth-heading").textContent = data.authenticated ? "知乎登录成功" : "不登录也能完整游玩";
    entry.textContent = data.authenticated ? "知乎账号与个性化引导" : "登录知乎，获得个性化参考";
    login.hidden = !!data.authenticated; login.disabled = !data.configured;
    personalize.hidden = !data.authenticated; personalize.disabled = !data.personalizationAvailable;
    logout.hidden = !data.authenticated;
    $("#zhihu-identity").hidden = !data.authenticated; $("#zhihu-name").textContent = data.profile?.name || "";
    const img = $("#zhihu-avatar"); img.hidden = true; img.removeAttribute("src");
    if (data.profile?.avatarUrl) { try { const u = new URL(data.profile.avatarUrl); if (u.protocol === "https:" && (u.hostname === "zhimg.com" || u.hostname.endsWith(".zhimg.com"))) { img.src = u.href; img.hidden = false; } } catch {} }
    img.onerror = () => { img.hidden = true; };
    renderGuidance(data.guidance);
  }
  async function api(path, method = "GET") {
    const startedAt = performance.now();
    const r = await fetchImpl("/api/auth/zhihu/" + path, { method, credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(path === "personalization" ? 50000 : 10000), ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}) });
    const data = await r.json(); if (!r.ok) throw Object.assign(new Error("request_failed"), { code: data.error }); if (path === "status" && data.authenticated) data.expiresAt = startedAt + Math.min(Number(data.expiresInMs) || 0, 8 * 3600e3); return data;
  }
  async function refresh() {
    if (pending || loggingOut) return; pending = true; retry.disabled = true; detail.setAttribute("aria-busy", "true");
    const current = generation;
    try { const data = await api("status"); if (current === generation) display(data); }
    catch { if (current !== generation) return; detail.textContent = "登录服务暂不可用，当前继续公共参考模式。网络恢复后可以重新检查。"; login.disabled = true; }
    finally { pending = false; retry.disabled = false; detail.removeAttribute("aria-busy"); }
  }
  entry.addEventListener("click", () => { open(); refresh(); });
  $("#zhihu-close").addEventListener("click", () => dialog.close());
  $("#zhihu-continue").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { signalModal(); entry.focus({ preventScroll: true }); });
  retry.addEventListener("click", () => { callbackReason = null; refresh(); });
  login.addEventListener("click", async () => {
    if (pending || loggingOut) return; pending = true; login.disabled = true; callbackReason = null;
    try { const data = await api("login", "POST"); location.assign(authorizedRedirect(data.url, location.origin)); }
    catch { detail.textContent = "暂时无法发起安全授权，请稍后重试；你的游戏进度不会清空。"; pending = false; login.disabled = !state?.configured; }
  });
  personalize.addEventListener("click", async () => {
    if (pending || loggingOut) return; const current = generation; pending = true; personalize.disabled = true; personalize.textContent = "正在读取少量授权资料…";
    try { const data = await api("personalization", "POST"); if (current !== generation || !state?.authenticated) return; if (state.expiresAt <= performance.now()) { expireSession(); return; } renderGuidance(data.guidance); if (state) state.guidance = data.guidance; }
    catch (e) {
      if (current !== generation) return;
      if (["auth_expired", "login_required"].includes(e.code)) { display({ configured: true, authenticated: false }); detail.textContent = "授权已失效，已停止读取。可重新登录，或继续公共模式。"; }
      else detail.textContent = "个性化参考暂不可用，仍可自由选信与继续游戏。";
    } finally { pending = false; personalize.disabled = !state?.personalizationAvailable; personalize.textContent = "生成个性化引导"; }
  });
  logout.addEventListener("click", async () => {
    // Logout remains usable during a slow personalization request; server invalidates its result.
    if (loggingOut) return;
    loggingOut = true; generation++; logout.disabled = true;
    try { await api("logout", "POST"); callbackReason = null; display({ configured: state?.configured ?? true, authenticated: false }); }
    catch { detail.textContent = "退出请求未成功，请重试；暂时不要关闭页面。"; }
    finally { generation++; loggingOut = false; logout.disabled = false; }
  });
  entry.disabled = false;
  refresh().then(() => { if (callbackReason) open(); });
  window.addEventListener("pageshow", e => { if (e.persisted) refresh(); });
}
if (typeof document !== "undefined") mountAuth();
