// Real Chrome + real server + local mock model. A budget of ONE mock call must not interrupt the story.
// No LLM credentials, no publishing, fresh cache/profile on every run.
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
const ROOT = process.cwd(), sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.on("error", reject); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const temp = await mkdtemp(path.join(tmpdir(), "echo-research-browser-"));
const output = path.resolve(process.env.AUDIT_OUTPUT || path.join(ROOT, "artifacts", "budget-protection-2026-09-13")); await mkdir(output, { recursive: true });
const port = await freePort(), debug = await freePort(), base = `http://127.0.0.1:${port}`;
const report = { at: new Date().toISOString(), steps: [], checks: {}, errors: [], llm: "deepseek-local-mock", authenticatedZhihu: false };
let captureFailure, ws, server, chrome, mock, mockCalls = 0, currentStep = "startup";
try {
  mock = http.createServer(async (req,res) => {
    for await (const chunk of req) {} mockCalls++;
    res.writeHead(200,{"Content-Type":"text/event-stream"});
    res.end('data: '+JSON.stringify({choices:[{delta:{content:"这是本地 mock 生成的角色表达，不是真实 DeepSeek。租房页面不是误点，我们可以先谈谈真正的顾虑，再一起想下一步。"}}]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(r=>mock.listen(0,"127.0.0.1",r));
  server = spawn(process.execPath, ["server.mjs"], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", LLM_PROVIDER: "deepseek", LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}`, LLM_API_KEY: "local-browser-mock", LLM_MODEL: "deepseek-flash",
    API_LIVE_ENABLED: "true", API_BUDGET_DB: path.join(temp,"budget.sqlite"), API_LLM_DAILY_CALLS: "1", API_LLM_TOTAL_CALLS: "1", API_LLM_DAILY_UNITS: "100000", API_LLM_TOTAL_UNITS: "100000", API_PLAYER_PER_MINUTE: "100", API_IP_PER_MINUTE: "100", ZHIHU_ACCESS_SECRET: "", ZHIHU_OAUTH_APP_ID:"", ZHIHU_OAUTH_APP_KEY:"", ZHIHU_OAUTH_REDIRECT_URI:"", ZHIHU_KNOWLEDGE_ENABLED: "false", ZHIHU_CACHE_DIR: path.join(temp, "cache") }, stdio: "ignore", windowsHide: true });
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


  await call('Page.enable'); await call('Runtime.enable'); await viewport(1440,1000); await call('Page.navigate',{url:base});
  await waitFor('document.querySelector("#start-shift")');
  if(await evaluate('!!document.querySelector("#guide-skip") && !document.querySelector(".guide-card")?.hidden'))await click('#guide-skip');
  step('真实点击：拆信、召唤与一次 mock 实时回答');
  await click('#start-shift');await waitFor('document.querySelector("#go-sort")');await click('#go-sort');
  const assignments={s1:'fact',s2:'fact',s3:'clue',s4:'emotion',s5:'bias',s6:'demand',s7:'avoidance',s8:'fact',s9:'emotion'};
  for(const [id,type] of Object.entries(assignments)){await click(`.frag[data-id="${id}"]`);await click(`.tray-choice[data-choice="${type}"]`);}
  await click('#seal');await waitFor('document.querySelector("#go-talk")');await click('#go-talk');
  await click('.card[data-char="silent"]');await waitFor('document.querySelector("#q") && !document.querySelector("#q").disabled');
  await fill('#q','阿姨，那个租房页面是误点的吗？');await click('#send');
  await waitFor('document.querySelector("#send") && !document.querySelector("#send").disabled');
  assert.equal((await state()).talks[0].generated,true);assert.equal(mockCalls,1);report.checks.firstMockGenerated=true;
  await screenshot('01-first-mock-reply');
  step('第二次提问触发真实账本限制，清晰提示经典模式');
  await fill('#q','您最怕的是什么？');await click('#send');
  await waitFor('document.querySelector("#send") && !document.querySelector("#send").disabled');
  const second=await state();assert.equal(second.talks.length,2);assert.equal(second.talks[1].generated,false);assert.equal(mockCalls,1);
  assert.equal(await evaluate('document.querySelector("#api-budget-notice").hidden'),false);
  assert.match(await evaluate('document.querySelector("#api-budget-notice").textContent'),/经典模式/);
  await screenshot('02-budget-fallback-desktop');report.checks.fallback=true;
  step('移动端额度提示与互动布局：390×844、320×568');
  for(const [w,h] of [[390,844],[320,568]]){
    await viewport(w,h,true);await evaluate('scrollTo(0,0)');
    const box=await evaluate('(()=>{const el=document.querySelector("#api-budget-notice"),r=el.getBoundingClientRect();return {width:el.clientWidth,scroll:el.scrollWidth,right:r.right}})()');
    assert.ok(box.scroll<=box.width+1 && box.right<=w+1);await screenshot(`03-mobile-${w}`);
  }
  await viewport(1440,1000);
  step('预算耗尽后：落笔、点评、回响完整完成，不追加上游请求');
  await click('#go-write');await waitFor('document.querySelector("#reply")');
  const reply='南，我听见你的难过。先说结论：可以先和妈妈谈谈彼此真正的顾虑，再联系HR确认offer是否仍有效。租房页面不是误点，她可能也在替你考虑。你可以列一下杭州的生活预算和回家探望的安排，不急着替任何人下决定。';
  await fill('#reply',reply);await click('#post');
  await waitFor('document.querySelector("#review-txt.cursor")');
  assert.equal(await evaluate('document.querySelector("#to-echo").disabled'),true,'点评仍在流式输出时，不允许进入下一次变更');
  await waitFor('document.querySelector("#to-echo") && !document.querySelector("#to-echo").disabled');
  await screenshot('04-budget-review');await click('#to-echo');
  await waitFor('document.querySelector("#first-reflection") && document.querySelector("#again")');
  await waitFor('fetch("/api/session/"+JSON.parse(sessionStorage.getItem("echo.state")).sid+"/state").then(r=>r.json()).then(r=>r.session.endingResult?.generationPending===false)');
  const final=await state();assert.equal(final.phase,'echo');assert.equal(final.endingResult.generated,false);assert.equal(mockCalls,1);report.checks.completeWithoutMoreCalls=true;
  await screenshot('05-classic-ending');
  step('刷新结局不重新生成，经典模式说明保留');
  await call('Page.reload');await waitFor('document.querySelector("#first-reflection")');
  assert.equal(mockCalls,1);assert.equal((await state()).id,final.id);report.checks.refresh=true;
  assert.deepEqual(report.errors,[]);report.mockCalls=mockCalls;report.success=true;
  report.scope='Chrome真实点击；本地 mock LLM 允许一次调用后被真实 SQLite 预算阻断；没有真实知乎/DeepSeek请求。';
  console.log(JSON.stringify({success:true,mockCalls,checks:Object.keys(report.checks).length}));
} catch (error) { if (captureFailure) try { await captureFailure(); } catch (captureError) { report.captureError = captureError.message; } report.success = false; report.failure = { step: currentStep, message: error.message }; console.error(error); process.exitCode = 1; }
finally {
  await writeFile(path.join(output, "browser-report.json"), JSON.stringify(report, null, 2)); ws?.close(); chrome?.kill(); server?.kill(); mock?.closeAllConnections(); if(mock)await new Promise(r=>mock.close(r));
  // Only this script's freshly-created temporary directory is eligible for removal.
  if (path.dirname(path.resolve(temp)) === path.resolve(tmpdir()) && path.basename(temp).startsWith("echo-research-browser-")) {
    await sleep(800); try { await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) { console.error("Temporary profile cleanup failed:", e.code, temp); }
  }
}
