import test from "node:test";
import assert from "node:assert/strict";
import { createOAuth } from "../lib/oauth.mjs";

function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(status, headers = {}) { this.status = status; for (const [k, v] of Object.entries(headers)) this.setHeader(k, v); },
    end(text = "") { this.text = text; } };
}
async function request(auth, url, method = "GET") {
  const res = response(); assert.equal(await auth.handle({ url, method, headers: {} }, res), true); return res;
}

test("未配置 OAuth 时明确公共参考，不伪造已授权或个人额度", async () => {
  const auth = createOAuth({ env: {} });
  const res = await request(auth, "/api/auth/zhihu/status");
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.text), { configured: false, authenticated: false, profile: null,
    mode: "public", personalized: false, reason: "not_configured", quotaMode: "shared" });
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers["set-cookie"], undefined);
});

test("即使存在 App 配置也等待后续接入，不发起授权或返回密钥", async () => {
  const auth = createOAuth({ env: { ZHIHU_OAUTH_APP_ID: "private-app-id", ZHIHU_OAUTH_APP_KEY: "private-app-key",
    ZHIHU_OAUTH_REDIRECT_URI: "https://registered.example/callback" } });
  const res = await request(auth, "/api/auth/zhihu/status");
  const data = JSON.parse(res.text);
  assert.equal(data.configured, true); assert.equal(data.reason, "authorization_pending");
  assert.equal(data.authenticated, false); assert.equal(data.personalized, false);
  assert.equal(data.mode, "public"); assert.equal(data.quotaMode, "shared");
  assert.ok(!res.text.includes("private-app")); assert.ok(!res.text.includes("registered.example"));
});

test("未授权/登录不可用自动返回公共模式，无第三方跳转", async () => {
  const auth = createOAuth({ env: {} });
  const res = await request(auth, "/api/auth/zhihu/login", "POST");
  assert.equal(res.status, 503);
  assert.equal(JSON.parse(res.text).mode, "public");
  assert.equal(JSON.parse(res.text).error, "authorization_unavailable");
  assert.equal(res.headers.location, undefined); assert.equal(res.headers["set-cookie"], undefined);
});

test("不接收真实回调；授权码、state 和错误文本不会被反射到响应", async () => {
  const auth = createOAuth({ env: {} });
  const res = await request(auth, "/api/auth/zhihu/callback?authorization_code=secret-code&state=secret-state&error=private-error");
  assert.equal(res.status, 404); assert.equal(JSON.parse(res.text).mode, "public");
  for (const text of ["secret-code", "secret-state", "private-error"]) assert.ok(!res.text.includes(text));
  assert.equal(res.headers["referrer-policy"], "no-referrer");
});

test("预留接口严格限制方法且不影响其他游戏路由", async () => {
  const auth = createOAuth({ env: {} });
  assert.equal((await request(auth, "/api/auth/zhihu/login")).status, 405);
  assert.equal((await request(auth, "/api/auth/zhihu/status", "POST")).status, 405);
  assert.equal(await auth.handle({ url: "/api/letters", method: "GET" }, response()), false);
});

// Pure presentation contract: server errors and unsupported identity states never claim personalization.
import { authMessage } from "../public/auth.js";
test("未配置/未授权/授权失败的界面说明均回退公共模式", () => {
  assert.match(authMessage({ configured: false }), /OAuth 尚未配置.*公共参考模式/);
  assert.match(authMessage({ configured: true, authenticated: false }), /尚未获得知乎授权.*公共参考模式/);
  for (const reason of ["upstream_failed", "state_invalid", "authorization_incomplete", "authorization_failed", "access_denied"])
    assert.match(authMessage({ configured: true, reason }), /已回退到公共参考模式/);
  assert.match(authMessage({ configured: true, authenticated: true }), /个性化参考尚未启用/);
  assert.throws(() => authMessage({}), /invalid_status/);
  assert.ok(!authMessage({ configured: true, reason: "private-error" }).includes("private-error"));
});
