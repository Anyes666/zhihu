// 本阶段只预留身份入口。真实授权、Token 交换和个性化数据读取尚未启用。
// OAuth 不等于切换搜索额度；公共参考始终使用原有数据客户端与缓存。
export function createOAuth({ env = process.env } = {}) {
  const configured = Boolean(env.ZHIHU_OAUTH_APP_ID?.trim() && env.ZHIHU_OAUTH_APP_KEY?.trim() && env.ZHIHU_OAUTH_REDIRECT_URI?.trim());
  const status = () => ({ configured, authenticated: false, profile: null, mode: "public", personalized: false,
    reason: configured ? "authorization_pending" : "not_configured", quotaMode: "shared" });
  async function handle(req, res) {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (!pathname.startsWith("/api/auth/zhihu/")) return false;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const json = (code, value) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(value)); };
    const methods = { "/api/auth/zhihu/status": "GET", "/api/auth/zhihu/login": "POST" };
    const method = methods[pathname];
    if (!method) { json(404, { error: "authorization_unavailable", mode: "public" }); return true; }
    if (req.method !== method) { res.setHeader("Allow", method); json(405, { error: "method_not_allowed", mode: "public" }); return true; }
    if (pathname.endsWith("/status")) json(200, status());
    else json(503, { ...status(), error: "authorization_unavailable" });
    return true;
  }
  return { handle };
}
