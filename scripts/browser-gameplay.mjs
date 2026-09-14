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
  let truncateNext = false;
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { const { resolve, reject, timer } = pending.get(msg.id); clearTimeout(timer); pending.delete(msg.id); msg.error ? reject(Error(msg.error.message)) : resolve(msg.result); }
    if (msg.method === 'Fetch.requestPaused') {
      const requestId = msg.params.requestId;
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

  await waitFor('document.querySelector("#guide-skip")'); await click('#guide-skip');
  const cases = [
    {id:'leaving',w:320,h:568,question:'阿姨，那个租房页面，您最担心的是什么？',reply:'南，我听见你想去杭州，又担心妈妈一个人在家的矛盾。先不要把离开等同于背叛，也不要替妈妈判断她一定接受不了。租房页面值得坐下来聊一聊，听她说出真实打算。你可以先向 HR 确认机会是否仍然有效，再核对预算、照顾安排和回家探望的时间。信息没问清之前，不急着替自己作最终决定。'},
    {id:'third-try',w:390,h:844,question:'叔叔，那件反光马甲是做什么用的？',reply:'我听见你想再坚持一次，也担心让家人失望。先不急着选择，请先和爸爸聊聊反光马甲的事情，再核对前两次考试的结果与目标学校。今晚可以写下预算和备考的时间安排，了解就业的另一条路。你可以保留选择，信息不清楚时不要把猜测当成事实。'},
    {id:'colleague',w:1440,h:1000,question:'小陈，那天在楼道里，你想对我说什么？',reply:'先说结论：我建议先核对事实再决定如何开口。我听见你对同事的担心，也不想让责任被忽略。可以先找出抽检和复检的记录，问清签名、时间与两批货的差别，再和小陈一起核对。今晚先记下确认和未确认的事，不急着指责，也不要替任何人作保证。'}
  ];
  for (const scenario of cases) {
    step(`${scenario.id} / ${scenario.w}×${scenario.h} / 真实分类与核心闭环`);
    await viewport(scenario.w,scenario.h,scenario.w<500); await click(`.env[data-id="${scenario.id}"]`); await click('#go-sort');
    let index = 0;
    for (const segment of LETTERS[scenario.id].body) {
      await click(`.frag[data-id="${segment.id}"]`);
      if (!index++) {
        await screenshot(`${scenario.id}-01-selected`,'#sort-selection');
        assert.equal(await evaluate('document.querySelector("#sort-selection blockquote").textContent'),segment.text);
        // Clicking a focusable quote then Tab + Enter uses the actual keyboard route.
        await click('#sort-selection blockquote'); await key('Tab','Tab',9); await key('Enter','Enter',13);
        if (segment.type !== 'fact') { await click(`.frag[data-id="${segment.id}"]`); await click(`[data-place="${segment.type}"]`); }
        assert.equal(await evaluate('document.querySelector("#prog-t").textContent.trim().startsWith("1 /")'),true);
      } else await click(`[data-place="${segment.type}"]`);
    }
    await click('#seal'); await click('#go-talk'); await click('.card[data-char="silent"]');
    const before = await state(); assert.ok(before.mailFacts.length>0);
    await click('.mail-facts > summary'); await click('.mail-facts [data-clue]');
    assert.ok(await evaluate('document.querySelector("#q").value.includes("关于")')); assert.deepEqual(await state(),before);
    if (scenario.id === 'leaving') {
      step('请求未到服务器：不扣邮票，草稿可重试');
      await call('Network.enable'); await call('Network.setBlockedURLs',{urls:['*/ask']});
      await fill('#q',scenario.question); await click('#send');
      await waitFor('document.querySelector("#msgs").textContent.includes("本次提问未被受理")');
      assert.deepEqual(await state(),before); assert.equal(await evaluate('document.querySelector("#q").value'),scenario.question);
      await screenshot('leaving-02-network-failed','#chat'); await call('Network.setBlockedURLs',{urls:[]});
    }
    await fill('#q',scenario.question); await click('#send'); await waitFor('document.querySelector("#action-receipt:not([hidden])") && !document.querySelector("#q").disabled');
    const after = await state(); const receipt = after.talks.at(-1).receipt;
    assert.equal(after.resources.stamps,before.resources.stamps-1); assert.equal(receipt.stamps.after,after.resources.stamps);
    assert.ok((await evaluate('document.querySelector("#action-receipt").innerText')).includes(`${receipt.stamps.before} → ${receipt.stamps.after}`));
    await screenshot(`${scenario.id}-03-action-receipt`,'#action-receipt');
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
    if (scenario.id === 'leaving') {
      step('重复发送复用原回执，不重复扣费');
      await fill('#q',scenario.question); await click('#send'); await waitFor('document.querySelector("#action-receipt").textContent.includes("重复请求")'); assert.deepEqual(await state(),after);
      step('服务端已受理但SSE截断：真实点击后核实状态，不制造假成功');
      await call('Fetch.enable',{patterns:[{urlPattern:'*/ask',requestStage:'Response'}]}); truncateNext = true;
      const q='我想先听你说，你最担心的事情是什么？'; await fill('#q',q); await click('#send');
      await waitFor('document.querySelector("#action-receipt").textContent.includes("已核实服务端")'); await call('Fetch.disable');
      for (let i=0;i<50 && typeof (await state()).talks.at(-1).generated!=='boolean';i++) await sleep(100);
      const restored = await state(); assert.equal(restored.talks.length,after.talks.length+1); assert.equal(restored.resources.stamps,after.resources.stamps-1);
      await screenshot('leaving-04-response-recovered','#action-receipt');
      await call('Page.reload'); await waitFor('document.querySelector("#action-receipt:not([hidden])")'); assert.deepEqual(await state(),restored);
    }
    await click('#go-write'); await waitFor('document.querySelector("#reply")');
    await fill('#reply',scenario.reply); const draft=await evaluate('document.querySelector("#reply").value');
    await click('.writing-rails > summary'); assert.equal(await evaluate('document.querySelector("#reply").value'),draft);
    await call('Page.reload'); await waitFor('document.querySelector("#reply")'); assert.equal(await evaluate('document.querySelector("#reply").value'),draft);
    await screenshot(`${scenario.id}-05-writing`,'#reply');
    await click('#post'); await waitFor('document.querySelector("#to-echo") && !document.querySelector("#to-echo").disabled'); await click('#to-echo'); await waitFor('document.querySelector(".parallel-open")');
    const frozen = await state(); assert.equal(frozen.phase,'echo');
    assert.equal(frozen.endingResult.evidence.confirmed.count, frozen.truthsUnlocked.length);
    assert.ok(!await evaluate('document.querySelector("#echo-side").textContent.includes("你看见了信的全部")'));
    await screenshot(`${scenario.id}-06-ending`,'.persona');
    await click('.parallel-open'); const alternative=scenario.reply.replace('先','暂时先')+' 请用自己的节奏做选择。';
    await fill('#parallel-reply',alternative); await click('.parallel-form button'); await waitFor('document.querySelectorAll(".parallel-outcomes article").length===2');
    assert.deepEqual(await state(),frozen); assert.ok(await evaluate('document.querySelector(".parallel-result").textContent.includes("已确认真相")'));
    await screenshot(`${scenario.id}-07-parallel`,'.parallel-outcomes');
    // A failed request must clear old success, keep alternate text and formal archive.
    await fill('#parallel-reply',alternative+' 我愿意听你说。'); await call('Network.enable'); await call('Network.setBlockedURLs',{urls:['*/rehearsal']}); await click('.parallel-form button');
    await waitFor('document.querySelector(".parallel-status").textContent.includes("对照未更新")'); assert.equal(await evaluate('document.querySelector(".parallel-result").children.length'),0); assert.deepEqual(await state(),frozen);
    await call('Network.setBlockedURLs',{urls:[]}); await click('.parallel-form button'); await waitFor('document.querySelectorAll(".parallel-outcomes article").length===2'); assert.deepEqual(await state(),frozen);
    report.checks[scenario.id]={classicComplete:true,width:scenario.w,receiptMatches:true,formalArchiveUnchanged:true,confirmed:frozen.endingResult.evidence.confirmed,coverage:frozen.endingResult.evidence.coverage};
    await click('.parallel-next'); await waitFor('document.querySelector("#start-shift")');
  }
  assert.deepEqual(report.errors,[]); report.success=true; console.log(JSON.stringify(report,null,2));
} catch (error) { if (captureFailure) try { await captureFailure(); } catch (captureError) { report.captureError = captureError.message; } report.success = false; report.failure = { step: currentStep, message: error.message }; console.error(error); process.exitCode = 1; }
finally {
  await writeFile(path.join(output, "browser-report.json"), JSON.stringify(report, null, 2)); ws?.close(); chrome?.kill(); server?.kill();
  // Only this script's freshly-created temporary directory is eligible for removal.
  if (path.dirname(path.resolve(temp)) === path.resolve(tmpdir()) && path.basename(temp).startsWith("echo-research-browser-")) {
    await sleep(800); try { await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) { console.error("Temporary profile cleanup failed:", e.code, temp); }
  }
}
