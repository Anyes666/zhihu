// Real Chrome + real local server. External capabilities disabled to verify optional guidance.
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
const output = path.join(ROOT, "artifacts", "onboarding"); await mkdir(output, { recursive: true });
const port = await freePort(), debug = await freePort(), base = `http://127.0.0.1:${port}`;
const report = { at: new Date().toISOString(), steps: [], checks: {}, errors: [], llm: "none", authenticatedZhihu: false };
let captureFailure, ws, server, chrome, currentStep = "startup";
try {
  server = spawn(process.execPath, ["server.mjs"], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", LLM_PROVIDER: "none", LLM_API_KEY: "", ZHIHU_ACCESS_SECRET: "", ZHIHU_KNOWLEDGE_ENABLED: "false", ZHIHU_CACHE_DIR: path.join(temp, "cache") }, stdio: "ignore", windowsHide: true });
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

  const guided = id => waitFor(`document.querySelector('.guide-card:not([hidden])')?.dataset.step === ${JSON.stringify(id)}`);
  const hidden = () => evaluate('document.querySelector(".guide-card").hidden');
  const guideState = () => evaluate('JSON.parse(localStorage.getItem("echo.guide.v1"))');
  const inspect = async name => {
    await sleep(250);
    const boxes = await evaluate(`(()=>{const c=document.querySelector('.guide-card'),r=document.querySelector('.guide-ring');const rect=e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}};return {card:rect(c),ring:rect(r),ringHidden:r.hidden,width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,step:c.dataset.step}})()`);
    assert.ok(boxes.scroll<=boxes.width, name+' horizontal overflow');
    assert.ok(boxes.card.left>=0 && boxes.card.right<=boxes.width+1 && boxes.card.top>=0 && boxes.card.bottom<=boxes.height+1,name+' tooltip in viewport');
    assert.equal(boxes.ringHidden,false,name+' spotlight target visible');
    if(!boxes.ringHidden) {
      const a=boxes.card,b=boxes.ring;
      assert.ok(!(a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top), name+' highlighted target covered');
    }
    report.checks[name]=boxes;
    await screenshot(name);
  };
  await call('Page.enable'); await call('Runtime.enable'); await viewport(390,844,true); await call('Page.navigate',{url:base});
  step('首次邀请 / 手机实际聚光 / 跳过后刷新不再弹出'); await guided('welcome'); await inspect('01-welcome-mobile');
  await click('#guide-skip'); assert.equal(await hidden(),true); assert.equal((await guideState()).status,'skipped');
  await call('Page.reload'); await waitFor('document.querySelector("#start-shift")'); assert.equal(await hidden(),true);
  step('重开引导 / Escape收起与键盘恢复 / 不创建会话');
  await evaluate('localStorage.removeItem("echo.guide.v1")'); await call('Page.reload'); await guided('welcome'); await click('#guide-next'); await guided('home');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  assert.equal(await hidden(),true); assert.equal(await evaluate('document.activeElement.id'),'guide-help');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await guided('home'); assert.equal(await evaluate('JSON.parse(sessionStorage.getItem("echo.state"))?.sid || null'),null);
  await click('#start-shift'); await guided('read'); await inspect('02-read-mobile');
  await click('#guide-next'); await guided('read-next'); await click('#go-sort'); await guided('sort-pick');
  const assignments={s1:'fact',s2:'fact',s3:'clue',s4:'emotion',s5:'bias',s6:'demand',s7:'avoidance',s8:'fact',s9:'emotion'};
  step('拆信真实点击 / 引导不代填 / 分类刷新恢复');
  assert.equal(await evaluate('document.querySelectorAll(".frag.placed").length'),0);
  await inspect('03-sort-pick-mobile');
  let n=0;
  for(const [id,type] of Object.entries(assignments)) {
    await click(`.frag[data-id="${id}"]`); await guided('sort-place');
    if(n===0) await inspect('04-sort-place-mobile');
    await click(`.tray[data-cat="${type}"] h4`); n++;
    if(n===3){await call('Page.reload');await guided('sort-pick');assert.equal(await evaluate('document.querySelectorAll(".frag.placed").length'),3);}
  }
  await guided('sort-seal'); await click('#seal'); await guided('sort-done'); await click('#go-talk'); await guided('cast'); await inspect('05-cast-mobile');
  step('召唤请求失败不前进、不扣次数 / 不同角色自由选择');
  const original=await state(); await call('Network.enable'); await call('Network.setBlockedURLs',{urls:['*/summon']});
  await click('.card[data-char="silent"]'); await guided('cast'); assert.deepEqual(await state(),original);
  await call('Network.setBlockedURLs',{urls:[]});
  await click('.card[data-char="silent"]'); await guided('ask'); await inspect('06-ask-mobile');
  await viewport(360,640,true); await inspect('06b-ask-small-mobile'); await viewport(390,844,true);
  const before=await state(); await click('[data-starter="0"]'); assert.deepEqual(await state(),before); await guided('ask');
  await viewport(1440,1000); await inspect('07-ask-desktop');
  step('真实提问推进 / 引导不消费额外资源 / 刷新保留进度');
  const question='阿姨，那个租房页面，您最怕的是什么？'; await fill('#q',question); await click('#send'); await guided('listen');
  assert.equal((await state()).talks.length,1); assert.equal((await state()).resources.stamps,before.resources.stamps-1);
  await inspect('08-listen-desktop');
  await click('#guide-next'); await guided('research');
  await call('Page.reload'); await guided('research');
  const optionalBefore=await state(); await click('#guide-next'); await guided('to-write'); assert.deepEqual(await state(),optionalBefore);
  await click('#guide-skip'); await click('#guide-help'); await guided('listen'); await click('#guide-next'); await guided('research');
  step('知乎参考可选 / 接口不可用也可继续 / 不伪造来源');
  await click('#open-research'); await guided('sources'); await waitFor('document.querySelector(".research-channel")');
  report.checks.sourceUnavailable=await evaluate('document.querySelector(".research-channel").innerText');
  assert.ok(!report.checks.sourceUnavailable.includes('本次 API 获取'));
  await viewport(390,844,true); await inspect('09-sources-mobile');
  await click('#guide-next'); await guided('to-write');
  await click('#go-write'); await guided('write'); await inspect('10-write-mobile');
  step('落笔留安静 / 草稿恢复 / 指引可恢复且不覆盖内容');
  await click('#guide-next'); assert.equal(await hidden(),true);
  const reply='南，你已经很不容易了。先说结论：我建议先和妈妈坐下来谈一次，再确认是否去杭州。租房页面不是误点，她在意的是自己会不会成为你的负担，而不是简单地阻止你。今晚不妨给HR回一封邮件，确认offer是否还有效，再列一下杭州的生活预算和回家探望的安排。你可以选择自己的生活，也可以继续好好照顾妈妈，这不必是一道只能选一边的题。';
  await fill('#reply',reply); await call('Page.reload'); await waitFor('document.querySelector("#reply")'); assert.equal(await hidden(),true); assert.equal(await evaluate('document.querySelector("#reply").value'),reply);
  await click('#guide-help'); await guided('write'); await click('#guide-next');
  await click('#post'); await guided('review'); await inspect('11-review-mobile');
  const reviewed=await state(); await call('Page.reload'); await guided('review'); assert.deepEqual(await state(),reviewed);
  await click('#to-echo'); await guided('ending'); await inspect('12-ending-mobile');
  step('结尾回看真实提问与回信 / 非分数说教 / 完成后不重弹');
  assert.ok((await evaluate('document.querySelector("#first-reflection").innerText')).includes(question));
  assert.ok(reply.includes((await evaluate('document.querySelectorAll("#first-reflection blockquote")[1].textContent'))));
  await click('#guide-next'); await guided('reflection'); await inspect('13-reflection-mobile');
  await viewport(1440,1000); await inspect('14-reflection-desktop');
  const final=await state(); await click('#guide-next'); assert.equal((await guideState()).status,'complete'); assert.deepEqual(await state(),final);
  const stored=JSON.stringify(await guideState()); assert.ok(!stored.includes(question) && !stored.includes(reply));
  await screenshot('15-reflection-uncovered','#first-reflection');
  await click('#again'); await waitFor('document.querySelector("#start-shift")'); assert.equal(await hidden(),true);
  step('第二封信无跨局引导污染 / 中途重开与跳过保留资源');
  await click('.env[data-id="colleague"]'); await waitFor('document.querySelector("#go-sort")'); assert.equal(await hidden(),true);
  const second=await state(); await click('#guide-help'); await guided('read'); await click('#guide-skip'); assert.deepEqual(await state(),second);
  step('浏览器拒绝本地存储时安全降级 / 减少动态偏好');
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')}})`});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await call('Page.reload'); await guided('welcome'); assert.equal(await evaluate('document.querySelector("#guide-storage").hidden'),false);
  await click('#guide-skip'); assert.equal(await hidden(),true);
  report.checks.storageFailureSafe=true; report.checks.completedWithoutAutomaticActions=true;
  assert.deepEqual(report.errors,[]); report.success=true; console.log(JSON.stringify(report,null,2));
} catch (error) { if (captureFailure) try { await captureFailure(); } catch (captureError) { report.captureError = captureError.message; } report.success = false; report.failure = { step: currentStep, message: error.message }; console.error(error); process.exitCode = 1; }
finally {
  await writeFile(path.join(output, "browser-report.json"), JSON.stringify(report, null, 2)); ws?.close(); chrome?.kill(); server?.kill();
  // Only this script's freshly-created temporary directory is eligible for removal.
  if (path.dirname(path.resolve(temp)) === path.resolve(tmpdir()) && path.basename(temp).startsWith("echo-research-browser-")) {
    await sleep(800); try { await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) { console.error("Temporary profile cleanup failed:", e.code, temp); }
  }
}
