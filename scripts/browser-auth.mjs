// Real Chrome + real local server. OAuth entry only; failure scenarios use explicit browser-local mocks.
// No LLM credentials, no publishing, fresh cache/profile on every run.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
const ROOT = process.cwd(), sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.on("error", reject); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const temp = await mkdtemp(path.join(tmpdir(), "echo-research-browser-"));
const output = path.join(ROOT, "artifacts", "oauth-entry-2026-09-13"); await mkdir(output, { recursive: true });
const port = await freePort(), debug = await freePort(), base = `http://127.0.0.1:${port}`;
const report = { at: new Date().toISOString(), steps: [], checks: {}, errors: [], llm: "none", authenticatedZhihu: false };
let captureFailure, ws, server, chrome, currentStep = "startup";
try {
  server = spawn(process.execPath, ["server.mjs"], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", LLM_PROVIDER: "none", LLM_API_KEY: "", ZHIHU_ACCESS_SECRET: "", ZHIHU_OAUTH_APP_ID: "", ZHIHU_OAUTH_APP_KEY: "", ZHIHU_OAUTH_REDIRECT_URI: "", ZHIHU_KNOWLEDGE_ENABLED: "false", ZHIHU_CACHE_DIR: path.join(temp, "cache") }, stdio: "ignore", windowsHide: true });
  chrome = spawn(process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${debug}`, `--user-data-dir=${path.join(temp, "profile")}`, "about:blank"], { stdio: "ignore", windowsHide: true });
  let spawnError;
  for (const child of [server, chrome]) child.on("error", error => { spawnError = error; });
  let tab;
  for (let i = 0; i < 80; i++) {
    if (spawnError) throw spawnError;
    try { await fetch(base + "/api/health", { signal: AbortSignal.timeout(1000) }); const tabs = await fetch(`http://127.0.0.1:${debug}/json`).then(r => r.json()); tab = tabs.find(t => t.type === "page"); if (tab) break; } catch {}
    await sleep(150);
  }
  if (!tab) throw Error("Chrome or server unavailable");
  ws = new WebSocket(tab.webSocketDebuggerUrl); let seq = 0; const pending = new Map();
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { const { resolve, reject, timer } = pending.get(msg.id); clearTimeout(timer); pending.delete(msg.id); msg.error ? reject(Error(msg.error.message)) : resolve(msg.result); }
    if (msg.method === "Runtime.exceptionThrown") report.errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(Error("CDP timeout: " + method)); }, 15000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value; };
  const waitFor = async (expression, ms = 15000) => { const until = Date.now() + ms; while (Date.now() < until) { const r = await evaluate(expression); if (r) return r; await sleep(100); } throw Error("Page wait timed out: " + expression); };
  const step = text => { currentStep = text; report.steps.push(text); console.log(text); };
  const click = async selector => {
    await waitFor(`document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`); await sleep(80);
    const box = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await call("Input.dispatchMouseEvent", { type: "mousePressed", ...box, button: "left", clickCount: 1 }); await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...box, button: "left", clickCount: 1 });
  };
  const fill = async (selector, value) => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const screenshot = async (name, selector) => { if (selector) await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start',behavior:'instant'})`); await sleep(250); const shot = await call("Page.captureScreenshot", { format: "png" }); await writeFile(path.join(output, name + ".png"), Buffer.from(shot.data, "base64")); };
  captureFailure = async () => { await screenshot("failure"); report.pageAtFailure = await evaluate('({text:document.body.innerText.slice(-4000),progress:document.querySelector("#prog-t")?.textContent})'); };
  const viewport = (width, height, mobile = false) => call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  const state = async () => evaluate(`fetch('/api/session/'+JSON.parse(sessionStorage.getItem('echo.state')).sid+'/state').then(r=>r.json()).then(r=>r.session)`);


  step('真实 HTTP 预留接口：无配置、不跳转、不交换 Token');
  const statusResponse = await fetch(base + '/api/auth/zhihu/status');
  assert.equal(statusResponse.headers.get('cache-control'), 'no-store');
  assert.equal(statusResponse.headers.get('set-cookie'), null);
  assert.deepEqual(await statusResponse.json(), {configured:false,authenticated:false,profile:null,mode:'public',personalized:false,reason:'not_configured',quotaMode:'shared'});
  const loginResponse = await fetch(base + '/api/auth/zhihu/login', {method:'POST',redirect:'manual'});
  assert.equal(loginResponse.status,503); assert.equal(loginResponse.headers.get('location'),null);
  assert.equal((await loginResponse.json()).mode,'public');
  const unavailableCallback = await fetch(base + '/api/auth/zhihu/callback?authorization_code=mock-only', {redirect:'manual'});
  assert.equal(unavailableCallback.status,404); assert.ok(!(await unavailableCallback.text()).includes('mock-only'));
  report.checks.http = true;

  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await viewport(1440,1000); await call('Page.navigate',{url:base});
  await waitFor('document.querySelector("#start-shift")');
  await waitFor('!document.querySelector("#zhihu-retry").disabled');
  if (await evaluate('!!document.querySelector("#guide-skip") && !document.querySelector(".guide-card")?.hidden')) await click('#guide-skip');
  const detail = () => evaluate('document.querySelector("#zhihu-auth-detail").textContent');
  const closed = () => waitFor('!document.querySelector("#zhihu-dialog").open');
  const open = async () => { await click('#zhihu-entry'); await waitFor('document.querySelector("#zhihu-dialog").open && !document.querySelector("#zhihu-retry").disabled'); };
  step('桌面：真实点击入口、未配置说明、继续公共玩法');
  assert.equal(await evaluate('document.querySelector("#zhihu-entry").textContent'),'登录知乎，获得个性化参考');
  await open(); assert.match(await detail(),/OAuth 尚未配置/);
  assert.match(await evaluate('document.querySelector("#zhihu-dialog").innerText'),/不等于切换搜索额度/);
  await screenshot('01-desktop-unconfigured');
  await click('#zhihu-continue'); await closed();
  assert.equal(await evaluate('document.activeElement.id'),'zhihu-entry');
  await screenshot('02-desktop-public-home');
  report.checks.desktop = true;

  step('移动端 390×844 与短屏 320×568：无横向溢出、可退出、键盘焦点');
  for (const [width,height] of [[390,844],[320,568]]) {
    await viewport(width,height,true); await open();
    const box = await evaluate(`(()=>{const d=document.querySelector('#zhihu-dialog'),r=d.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:d.clientWidth,scroll:d.scrollWidth,viewport:innerWidth}})()`);
    assert.ok(box.x>=0 && box.right<=width+1 && box.y>=0 && box.bottom<=height+1,JSON.stringify(box));
    assert.ok(box.scroll<=box.width+1,JSON.stringify(box));
    assert.equal(await evaluate('document.querySelector("#zhihu-dialog").scrollTop'),0);
    await screenshot(`03-mobile-${width}-opened`);
    for(let i=0;i<4;i++) { await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9}); await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      assert.ok(await evaluate('document.querySelector("#zhihu-dialog").contains(document.activeElement) || document.activeElement === document.body')); }
    await screenshot(`03-mobile-${width}`);
    await click('#zhihu-close'); await closed();
    const strip = await evaluate(`(()=>{const e=document.querySelector('.auth-strip'),r=e.getBoundingClientRect();return {right:r.right,scroll:e.scrollWidth,width:e.clientWidth}})()`);
    assert.ok(strip.scroll<=strip.width+1 && strip.right<=width+1);
    report.checks['mobile-'+width]=true;
  }

  step('未授权/拒绝/HTTP 失败/断网/畸形响应/超时：显式本地 mock，不访问知乎');
  await viewport(1440,1000);
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=window.fetch;window.authMockMode='unauthorized';window.authMockCalls=0;window.fetch=(url,options)=>{
    if(String(url)!=='/api/auth/zhihu/status')return original(url,options);
    window.authMockCalls++;
    if(window.authMockMode==='network')return Promise.reject(new TypeError('mock network failure'));
    if(window.authMockMode==='hang')return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('mock abort','AbortError')),{once:true}));
    if(window.authMockMode==='http')return Promise.resolve(new Response('{}',{status:503}));
    if(window.authMockMode==='malformed')return Promise.resolve(new Response('<html>not JSON</html>'));
    const result={configured:true,authenticated:false,mode:'public',reason:window.authMockMode==='denied'?'access_denied':'authorization_pending'};
    return Promise.resolve(new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}}));
  };})()`});
  await call('Page.reload'); await waitFor('document.querySelector("#start-shift") && !document.querySelector("#zhihu-retry").disabled');
  for (const mode of ['unauthorized','denied','http','network','malformed','hang']) {
    await evaluate(`window.authMockMode=${JSON.stringify(mode)}`); await open();
    assert.match(await detail(),mode==='unauthorized'?/尚未获得知乎授权/:/已回退到公共参考模式/);
    assert.equal(await evaluate('location.origin'),base);
    assert.equal(await evaluate('document.querySelector("#zhihu-mode").textContent'),'当前使用公共参考模式');
    if(mode==='network')await screenshot('04-network-fallback');
    await click('#zhihu-continue'); await closed();
    report.checks["fallback-"+mode]=true;
  }

  step('失败后仍可开始/拆信；重试入口不丢本标签页进度');
  await click('#start-shift'); await waitFor('document.querySelector("#go-sort")'); await click('#go-sort');
  await waitFor('document.querySelector(".frag")');
  await click('.frag[data-id="s1"]'); await click('.tray[data-cat="fact"] h4');
  const saved = await evaluate('sessionStorage.getItem("echo.state")'), before = await state();
  await evaluate("window.authMockMode='network'"); await open();
  await click('#zhihu-retry'); await waitFor('!document.querySelector("#zhihu-retry").disabled');
  assert.match(await detail(),/已回退/);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}); await closed();
  assert.equal(await evaluate('sessionStorage.getItem("echo.state")'),saved);
  assert.deepEqual(await state(),before);
  assert.equal(await evaluate('document.querySelector("#prog-t").textContent'),'1 / 9');
  report.checks.progressPreserved=true;
  assert.deepEqual(report.errors,[]);
  report.success=true;
  report.scope='真实 Chrome + 本地真实 server；OAuth 未配置与登录预留 API 为真实响应；未授权/拒绝/网络故障由明确的浏览器 mock 模拟；未调用真实 OAuth、知乎或付费模型。';
  console.log(JSON.stringify({success:true,checks:Object.keys(report.checks).length}));
} catch (error) { if (captureFailure) try { await captureFailure(); } catch (captureError) { report.captureError = captureError.message; } report.success = false; report.failure = { step: currentStep, message: error.message }; console.error(error); process.exitCode = 1; }
finally {
  await writeFile(path.join(output, "browser-report.json"), JSON.stringify(report, null, 2)); ws?.close(); chrome?.kill(); server?.kill();
  // Only this script's freshly-created temporary directory is eligible for removal.
  if (path.dirname(path.resolve(temp)) === path.resolve(tmpdir()) && path.basename(temp).startsWith("echo-research-browser-")) {
    await sleep(800); try { await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) { console.error("Temporary profile cleanup failed:", e.code, temp); }
  }
}
