// Real Chrome + real local server. Knowledge uses an explicit local mock; no external API requests.
// No LLM credentials, no publishing, fresh cache/profile on every run.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { LETTERS } from "../lib/engine.mjs";
const ROOT = process.cwd(), sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.on("error", reject); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const temp = await mkdtemp(path.join(tmpdir(), "echo-research-browser-"));
const output = path.resolve(process.env.AUDIT_OUTPUT || path.join(ROOT, "artifacts", "gameplay-upgrade-20260914", "gameplay-browser")); await mkdir(output, { recursive: true });
const port = await freePort(), debug = await freePort(), base = `http://127.0.0.1:${port}`;
const report = { at: new Date().toISOString(), steps: [], checks: {}, errors: [], llm: "none", authenticatedZhihu: false };
let captureFailure, ws, server, chrome, currentStep = "startup";
try {
  server = spawn(process.execPath, ["server.mjs"], { cwd: ROOT, env: { ...process.env, NODE_ENV: "test", API_LIVE_ENABLED: "false", API_PLAYER_PER_MINUTE: "500", API_IP_PER_MINUTE: "500", API_BUDGET_DB: path.join(temp,"budget.sqlite"), API_KNOWLEDGE_DAILY_CALLS: "100", API_KNOWLEDGE_TOTAL_CALLS: "100", PORT: String(port), HOST: "127.0.0.1", LLM_PROVIDER: "none", LLM_API_KEY: "", ZHIHU_ACCESS_SECRET: "", ZHIHU_KNOWLEDGE_ENABLED: "false", ZHIHU_CACHE_DIR: path.join(temp, "cache") }, stdio: "ignore", windowsHide: true });
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
  let truncateNext = false, holdState = false, heldStateRequest = null;
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { const { resolve, reject, timer } = pending.get(msg.id); clearTimeout(timer); pending.delete(msg.id); msg.error ? reject(Error(msg.error.message)) : resolve(msg.result); }
    if (msg.method === 'Fetch.requestPaused') {
      const requestId = msg.params.requestId;
      if (holdState && new URL(msg.params.request.url).pathname.endsWith('/state')) { heldStateRequest=requestId; return; }
      if (truncateNext) {
        truncateNext = false;
        call('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/event-stream'}],body:Buffer.from('event: notice\ndata: {"text":"本地故障注入：模拟响应未完整到达"}\n\n').toString('base64')}).catch(e=>report.errors.push(e.message));
      } else call('Fetch.continueRequest',{requestId}).catch(e=>report.errors.push(e.message));
    }
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
  const key = async (key,code,vk,modifiers=0) => { await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk,modifiers,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})}); await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk,modifiers}); };
  const fill = async (selector,value) => { await click(selector); await key('a','KeyA',65,2); await call('Input.insertText',{text:value}); };

  const screenshot = async (name, selector) => { if (selector) await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start',behavior:'instant'});window.scrollBy(0,-document.querySelector('.top').getBoundingClientRect().height-12)`); await sleep(250); const shot = await call("Page.captureScreenshot", { format: "png" }); await writeFile(path.join(output, name + ".png"), Buffer.from(shot.data, "base64")); };
  captureFailure = async () => { await screenshot("failure"); report.pageAtFailure = await evaluate('({text:document.body.innerText.slice(-4000),progress:document.querySelector("#prog-t")?.textContent})'); };
  const viewport = (width, height, mobile = false) => call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  const state = async () => evaluate(`fetch('/api/session/'+JSON.parse(sessionStorage.getItem('echo.state')).sid+'/state').then(r=>r.json()).then(r=>r.session)`);
  await call("Page.enable"); await call("Runtime.enable"); await viewport(1440, 1000); await call("Page.navigate", { url: base });


  await click('#guide-skip');await click('#start-shift');await click('#go-sort');
  for(const seg of LETTERS.leaving.body){await click(`.frag[data-id="${seg.id}"]`);await click(`[data-place="${seg.type}"]`);}
  await click('#seal');await click('#go-talk');await click('.card[data-char="data"]');await click('.card[data-char="silent"]');
  const before=await state();
  step('提问与核实同时断网，切换已邀请角色后仍有恢复入口');
  await call('Network.enable');await call('Network.setBlockedURLs',{urls:['*/ask','*/state']});
  await fill('#q','阿姨，您最担心什么？');await click('#send');await waitFor('document.querySelector("#msgs").textContent.includes("无法确认")');
  await click('.card[data-char="data"]');
  await waitFor('document.querySelector("#chat-head").dataset.char==="data"');
  assert.equal(await evaluate('!!document.querySelector("#ask-recovery:not([hidden]) button")'),true,'切换角色不能丢失核实按钮');
  assert.equal(await evaluate('document.querySelector("#q").disabled'),true);
  assert.equal(await evaluate('document.querySelector("#go-write").disabled'),true,'核实前不能进入写作');
  await screenshot('01-uncertain-after-switch','#ask-recovery');
  await call('Network.setBlockedURLs',{urls:[]});await click('#ask-recovery button');await waitFor('!document.querySelector("#q").disabled');assert.deepEqual(await state(),before);
  step('旧会话待核实状态不污染主动新开局');
  await call('Network.setBlockedURLs',{urls:['*/ask','*/state']});await fill('#q','什么时候可以核对这些信息？');await click('#send');await waitFor('document.querySelector("#msgs").textContent.includes("无法确认")');
  await evaluate('window.confirm=()=>true');await click('#brand');await call('Network.setBlockedURLs',{urls:[]});await click('#start-shift');await click('#go-sort');
  for(const seg of LETTERS.leaving.body){await click(`.frag[data-id="${seg.id}"]`);await click(`[data-place="${seg.type}"]`);}
  await click('#seal');await click('#go-talk');await click('.card[data-char="silent"]');
  await waitFor('!document.querySelector("#q").disabled');
  assert.equal(await evaluate('document.querySelector("#q").disabled'),false);assert.notEqual((await state()).id,before.id);

  await screenshot('02-new-session-unlocked','#chat');
  step('旧局自动核实挂起期间新开局，迟到失败不能写入新局');
  await call('Fetch.enable',{patterns:[{urlPattern:'*/state',requestStage:'Request'}]});holdState=true;
  await call('Network.setBlockedURLs',{urls:['*/ask']});await fill('#q','我想听听您在担心什么？');await click('#send');
  for(let i=0;i<60 && !heldStateRequest;i++)await sleep(100);assert.ok(heldStateRequest,'自动核实请求确实挂起');
  await click('#brand');await call('Network.setBlockedURLs',{urls:[]});await click('#start-shift');await click('#go-sort');
  const idDuringNew=await evaluate('JSON.parse(sessionStorage.getItem("echo.state")).sid');
  holdState=false;await call('Fetch.failRequest',{requestId:heldStateRequest,errorReason:'Failed'});await call('Fetch.disable');
  await sleep(200);assert.equal(await evaluate('JSON.parse(sessionStorage.getItem("echo.state")).sid'),idDuringNew);
  for(const seg of LETTERS.leaving.body){await click(`.frag[data-id="${seg.id}"]`);await click(`[data-place="${seg.type}"]`);}
  await click('#seal');await click('#go-talk');await click('.card[data-char="silent"]');await waitFor('!document.querySelector("#q").disabled');
  await screenshot('03-late-old-failure-isolated','#chat');
  report.checks={recoverySurvivesRoleSwitch:true,noCrossSessionLock:true,lateOldFailureIsolated:true};assert.deepEqual(report.errors,[]);report.success=true;console.log(JSON.stringify(report,null,2));
} catch (error) { if (captureFailure) try { await captureFailure(); } catch (captureError) { report.captureError = captureError.message; } report.success = false; report.failure = { step: currentStep, message: error.message }; console.error(error); process.exitCode = 1; }
finally {
  await writeFile(path.join(output, "browser-report.json"), JSON.stringify(report, null, 2)); ws?.close(); chrome?.kill(); server?.kill();
  // Only this script's freshly-created temporary directory is eligible for removal.
  if (path.dirname(path.resolve(temp)) === path.resolve(tmpdir()) && path.basename(temp).startsWith("echo-research-browser-")) {
    await sleep(800); try { await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) { console.error("Temporary profile cleanup failed:", e.code, temp); }
  }
}
