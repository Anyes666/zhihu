import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authMessage, authorizedRedirect } from "../public/auth.js";
test("UI never describes authenticated player as a placeholder; context still requires consent",()=>{assert.match(authMessage({configured:true,authenticated:true}),/已登录/);assert.match(authMessage({configured:false}),/未配置/);assert.match(authMessage({configured:true,reason:"state_invalid"}),/安全校验/);});
test("frontend accepts only official authorize URL with current origin callback",()=>{const base="https://game.example";const ok="https://openapi.zhihu.com/authorize?app_id=506&response_type=code&state=123&redirect_uri="+encodeURIComponent(base+"/auth/callback");assert.equal(authorizedRedirect(ok,base),ok);for(const u of ["javascript:alert(1)","https://evil.example/authorize",ok.replace("openapi.zhihu.com","openapi.zhihu.com.evil.example"),ok.replace("game.example","evil.example")])assert.throws(()=>authorizedRedirect(u,base));});
test("game introduction is outside the changing game view and uses native details",()=>{const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");assert.match(html,/<details[^>]+id="game-intro"/);assert.ok(html.indexOf('id="game-intro"')>html.indexOf('<main id="app"'));assert.match(html,/id="zhihu-login"/);assert.match(html,/id="zhihu-personalize"/);});
