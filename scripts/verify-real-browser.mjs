// Real Chrome + real local server. Only public Zhihu knowledge is contacted.
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
const output = path.join(ROOT, "artifacts", "real-credentials-verification-2026-09-13", "browser"); await mkdir(output, { recursive: true });
const port = await freePort(), debug = await freePort(), base = `http://127.0.0.1:${port}`;
const report = { at: new Date().toISOString(), steps: [], checks: {}, errors: [], llm: "deepseek", authenticatedZhihu: true };
let captureFailure, ws, server, chrome, currentStep = "startup";
try {
  server = spawn(process.execPath, ["server.mjs"], { cwd: ROOT, env: { ...process.env, LLM_API_KEY: process.env.LLM_API_KEY, ZHIHU_ACCESS_SECRET: process.env.ZHIHU_ACCESS_SECRET, PORT: String(port), HOST: "127.0.0.1", LLM_PROVIDER: "deepseek", LLM_API_KEY: process.env.LLM_API_KEY || "", LLM_BASE_URL: "https://api.deepseek.com", LLM_MODEL: "deepseek-flash", ZHIHU_ACCESS_SECRET: process.env.ZHIHU_ACCESS_SECRET || "", ZHIHU_KNOWLEDGE_ENABLED: "true", ZHIHU_CACHE_DIR: path.join(temp, "cache") }, stdio: "ignore", windowsHide: true });
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
  await call("Page.enable"); await call("Runtime.enable"); await viewport(1440, 1000); await call("Page.navigate", { url: base });
  step("新版门厅 / 桌面与移动端 / 主入口"); await waitFor('document.querySelectorAll(".env").length === 3');
  await click('#guide-skip');
  assert.ok(await evaluate('document.querySelector("#start-shift")?.textContent.includes("第一封信")'));
  await screenshot("01-home-desktop"); await viewport(390,844,true); await screenshot("02-home-mobile");
  assert.equal(await evaluate('document.documentElement.scrollWidth'),390);
  await viewport(1440,1000);
  await click("#start-shift"); await click("#go-sort"); await waitFor('document.querySelectorAll(".frag").length === 9');
  const assignments = { s1: "fact", s2: "fact", s3: "clue", s4: "emotion", s5: "bias", s6: "demand", s7: "avoidance", s8: "fact", s9: "emotion" };
  for (const [id, type] of Object.entries(assignments)) { await click(`.frag[data-id="${id}"]`); await click(`.tray[data-cat="${type}"] h4`); }
  await click("#seal"); await click("#go-talk");
  step("寻声 / 角色提问真实事件绑定"); await click('.card[data-char="silent"]'); await waitFor('document.querySelector("#q") && !document.querySelector("#q").disabled');
  step("角色开口提示 / 填入不发送 / 切换角色清除旧问题");
  const beforeStarter = await state(); await click('[data-starter="0"]');
  assert.ok((await evaluate('document.querySelector("#q").value')).includes("租房"));
  assert.deepEqual(await state(),beforeStarter);
  await click('.card[data-char="data"]'); await waitFor('document.querySelector("#q") && !document.querySelector("#q").disabled');
  assert.equal(await evaluate('document.querySelector("#q").value'),"");
  await click('[data-starter="0"]'); assert.ok((await evaluate('document.querySelector("#q").value')).includes("HR"));
  await click('.card[data-char="silent"]'); await waitFor('document.querySelector("#q") && !document.querySelector("#q").disabled');
  assert.equal(await evaluate('document.querySelector("#q").value'),"");
  report.checks.starterNoAutoSend = true;
  await screenshot("03-talk-desktop", ".talk"); await viewport(390,844,true); await screenshot("04-talk-mobile", "#chat");
  assert.equal(await evaluate('document.documentElement.scrollWidth'),390); await viewport(1440,1000);
  assert.equal(await evaluate('document.querySelector("#journey [aria-current=step]").textContent.includes("寻声")'),true);
  await fill("#q", "阿姨，那个租房页面，您最怕的是什么？"); await click("#send"); await waitFor('document.querySelector("#trust-v")?.textContent !== "40" && !document.querySelector("#q").disabled');
  assert.equal((await state()).truthsUnlocked.length, 1); assert.equal((await state()).talks.at(-1).generated, true); assert.ok(await evaluate('document.querySelector(".reply-origin[data-origin=model]")?.textContent.includes("模型表达")')); const before = await state();
  step("参考台 / 真实知乎知识列表 / 明确来源"); await click(".research-desk > summary"); await waitFor('document.querySelectorAll(".research-card[data-capability=knowledge]").length > 0', 20000);
  const channel = await evaluate('document.querySelector(".research-channel").innerText'); assert.ok(channel.includes("本次 API 获取"), channel);
  report.checks.knowledge = { source: "live", cards: await evaluate('document.querySelectorAll(".research-card[data-source=live]").length'), channel };
  await screenshot("05-knowledge-desktop", ".research-desk");
  step("相似经历 / 未配置凭证的明确降级 / 自定义检索"); await click('[data-tab="search"]');
  assert.ok((await evaluate('document.querySelector(".research-channel").innerText')).includes("本次 API 获取") || (await evaluate('document.querySelector(".research-channel").innerText')).includes("本地缓存"));
  const beforeSuggestion = await state(); await click('[data-query="0"]');
  assert.ok((await evaluate('document.querySelector(".research-search input").value')).includes("父母"));
  assert.deepEqual(await state(),beforeSuggestion); report.checks.searchSuggestionNoRequest = true;
  await fill('.research-search input', "异地工作与亲子边界"); await click('.research-search button');
  await waitFor('document.querySelector(".research-search label")?.innerText.includes("剩余 2")');
  assert.ok((await evaluate('document.querySelector(".research-cards").innerText')).includes("没有可用资料"));
  report.checks.searchAuthenticated = true;
  await click('[data-tab="knowledge"]'); const selected = await evaluate(`[...document.querySelectorAll('.research-card[data-source="live"]')].find(c=>c.textContent.includes('心理被动'))?.querySelector('[data-select]')?.dataset.select`);
  const selectedId = selected || await evaluate('document.querySelector(".research-card[data-source=live] [data-select]")?.dataset.select');
  assert.ok(selectedId, "必须有实际 API 来源卡");
  await click(`[data-select="${selectedId}"]`);
  const reflection = "这条知识提醒我区分自己的意愿与被动迎合，但不能据此判断南或妈妈的心理状态，要先问清两人的想法。";
  await fill('.research-note-form select', "question"); await fill('.research-note-form textarea', reflection); await click('.research-note-form button');
  await waitFor('document.querySelectorAll(".research-notes .research-note").length === 1');
  const after = await state(); assert.deepEqual(after.resources, before.resources); assert.deepEqual(after.truthsUnlocked, before.truthsUnlocked); report.checks.noAutomaticRewards = true;
  step("移动端参考台 / 控件边界与保存笔记"); await viewport(390, 844, true); await screenshot("06-knowledge-mobile", ".research-desk");
  const overflow = await evaluate(`({scroll:document.documentElement.scrollWidth,width:innerWidth,fields:[...document.querySelectorAll('.research-desk button,.research-desk input,.research-desk textarea,.research-desk select')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.left<0||r.right>innerWidth+1)}).map(el=>el.outerHTML.slice(0,120))})`);
  assert.equal(overflow.scroll, overflow.width); assert.equal(overflow.fields.length, 0, JSON.stringify(overflow)); report.checks.mobile = overflow;
  step("刷新恢复 / 来源笔记不丢失"); await call("Page.reload"); await waitFor('document.querySelector(".research-desk")'); await click(".research-desk > summary"); await waitFor('document.querySelectorAll(".research-notes .research-note").length === 1');
  assert.ok((await evaluate('document.querySelector(".research-notes").innerText')).includes(reflection));
  await viewport(1440, 1000); await click("#go-write"); await waitFor('document.querySelector("#reply")'); assert.equal(await evaluate('document.querySelector("#reply").value'), "");
  step("落笔 / 已选来源随阶段保留 / 全文回信"); await click(".research-desk > summary"); await waitFor('document.querySelectorAll(".research-notes .research-note").length === 1');
  await screenshot("07-write-desktop", ".write");
  const reply = "南，你已经很不容易了。先说结论：我建议先和妈妈坐下来谈一次，再确认是否去杭州。租房页面不是误点，她在意的是自己会不会成为你的负担，而不是简单地阻止你。社区经验能提醒我先听你自己的意愿，却不能替你或妈妈作证。今晚不妨给HR回一封邮件，确认offer是否还有效，再列一下杭州的生活预算和回家探望的安排。你可以选择自己的生活，也可以继续好好照顾妈妈，这不必是一道只能选一边的题。";
  await fill("#reply", reply);
  step("自由回信暂存 / 刷新不丢草稿"); await call("Page.reload"); await waitFor('document.querySelector("#reply")');
  assert.equal(await evaluate('document.querySelector("#reply").value'),reply); report.checks.draftRestored = true;
  await click("#post"); await click("#to-echo");
  step("回响 / 来源回执 / 模拟评论 / 票数动画"); await waitFor('document.querySelector("#research-receipt") && document.querySelector("#up")', 20000); await sleep(1300);
  const receipt = await evaluate('document.querySelector("#research-receipt").innerText'); assert.ok(receipt.includes(reflection)); assert.ok(receipt.includes("1 条笔记来自实际 API"));
  const community = await evaluate('document.querySelector("#community").innerText'); assert.ok(community.includes("资料旁观者（模拟）")); assert.ok(!community.includes("知乎上真实存在的声音"));
  report.checks.ending = { receipt, upvotes: Number(await evaluate('document.querySelector("#up").textContent')), phase: (await state()).phase };
  assert.ok(report.checks.ending.upvotes > 0); assert.equal(report.checks.ending.phase, "echo");
  await screenshot("08-ending-desktop", ".echo"); await viewport(390, 844, true); await screenshot("09-receipt-mobile", "#research-receipt");
  const finalOverflow = await evaluate('document.documentElement.scrollWidth <= innerWidth'); assert.equal(finalOverflow, true);
  report.checks.health = await fetch(base + "/api/health").then(r => r.json()); assert.equal(report.checks.health.llm, "deepseek"); assert.equal(report.checks.health.zhihu, "live");
  step("平行试写 / 真实点击 / 风险回信对照 / 正式档案不变");
  await viewport(1440,1000); await click('.parallel > details > summary');
  const frozen = await state();
  const harmful = "你就是自私，必须马上离开！不要再跟妈妈联系，直接断绝关系。她只会拖累你，你根本不用管她，以后永远不要回家。";
  await fill("#parallel-reply",harmful); await click(".parallel-form button");
  await waitFor('document.querySelectorAll(".parallel-outcomes article").length===2');
  const safety = Number(await evaluate('document.querySelector(".parallel-deltas [data-dimension=safety]").dataset.delta'));
  assert.ok(safety < 0); assert.ok(await evaluate('document.querySelectorAll(".parallel-outcomes article")[1].querySelector(".risky") !== null'));
  assert.deepEqual(await state(), frozen);
  await screenshot("10-parallel-desktop", ".parallel-result");
  await viewport(390,844,true); await screenshot("11-parallel-mobile", ".parallel-result");
  assert.equal(await evaluate('document.documentElement.scrollWidth'),390);
  report.checks.rehearsal = { safetyDelta:safety, formalStateUnchanged:true };
  const invalid = await evaluate(`fetch('/api/session/'+JSON.parse(sessionStorage.getItem('echo.state')).sid+'/rehearsal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'短'})}).then(r=>r.status)`);
  assert.equal(invalid,400);
  await fill("#parallel-reply",reply); await click(".parallel-form button");
  await waitFor('Number(document.querySelector(".parallel-deltas [data-dimension=safety]").dataset.delta) === 0');
  assert.equal(await evaluate('[...document.querySelectorAll(".parallel-deltas [data-delta]")].every(el=>Number(el.dataset.delta)===0)'),true);
  assert.deepEqual(await state(),frozen);
  step("第二封信 / 参考资料不跨局串用"); await viewport(1440, 1000); await click("#again"); await click('.env[data-id="colleague"]'); await click("#go-sort");
  for (const [id, type] of Object.entries(assignments)) { await click(`.frag[data-id="${id}"]`); await click(`.tray[data-cat="${type}"] h4`); }
  await click("#seal"); await click("#go-talk"); await waitFor('document.querySelector("#echoes .echo-item b")');
  const expectedTitle = await evaluate(`fetch('/api/session/'+JSON.parse(sessionStorage.getItem('echo.state')).sid+'/materials').then(r=>r.json()).then(r=>r.items[0].title)`);
  assert.equal(await evaluate('document.querySelector("#echoes .echo-item b").textContent'), expectedTitle);
  report.checks.crossSessionSources = true;
  assert.deepEqual(report.errors, []); report.success = true; console.log(JSON.stringify(report, null, 2));
} catch (error) { if (captureFailure) try { await captureFailure(); } catch (captureError) { report.captureError = captureError.message; } report.success = false; report.failure = { step: currentStep, message: error.message }; console.error(error); process.exitCode = 1; }
finally {
  await writeFile(path.join(output, "browser-report.json"), JSON.stringify(report, null, 2)); ws?.close(); chrome?.kill(); server?.kill();
  // Only this script's freshly-created temporary directory is eligible for removal.
  if (path.dirname(path.resolve(temp)) === path.resolve(tmpdir()) && path.basename(temp).startsWith("echo-research-browser-")) {
    await sleep(800); try { await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) { console.error("Temporary profile cleanup failed:", e.code, temp); }
  }
}
