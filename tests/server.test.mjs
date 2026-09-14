// 服务端集成测试：在独立端口起真实 server.mjs，验证 API 全流程、SSE 事件序列、错误降级与频控
import test, { after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let testCache;
after(async () => {
  // Only remove this test run's own directory, never the application cache.
  if (testCache && path.dirname(path.resolve(testCache)) === path.resolve(tmpdir()) && path.basename(testCache).startsWith("echo-server-test-"))
    await rm(testCache, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
let proc, BASE, mock, mockMode = { mode: "ok" };

const sseChunk = c => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`;

async function post(p, body) {
  const res = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res;
}
const pj = async (p, b) => { const r = await post(p, b); return { status: r.status, json: await r.json() }; };
const gj = async p => { const r = await fetch(BASE + p); return { status: r.status, json: await r.json() }; };
// 解析 SSE：返回事件顺序数组与按名归并的最后一次载荷
async function pse(p, b) {
  const r = await post(p, b);
  assert.equal(r.headers.get("content-type"), "text/event-stream; charset=utf-8", "流式接口必须返回 SSE 头");
  const text = await r.text();
  const order = [], last = {}, deltas = [];
  for (const m of text.matchAll(/event: (\w+)\ndata: (.*)/g)) {
    order.push(m[1]);
    let v = m[2]; try { v = JSON.parse(m[2]); } catch {}
    if (m[1] === "delta") deltas.push(v); else last[m[1]] = v;
  }
  return { order, last, deltas, joined: deltas.join("") };
}

test("启动 mock LLM 与真实服务器", async () => {
  testCache = await mkdtemp(path.join(tmpdir(), "echo-server-test-"));
  mock = http.createServer((req, res) => {
    if (mockMode.mode === "fail") { res.writeHead(502); return res.end("{}"); }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (mockMode.mode === "hang") return;
    const t = mockMode.mode === "markdown" ? "**列表**\n- a\n- b" : "这是模型生成的那一句话，语气按态度做了调整，事实沿用骨架。";
    for (const ch of t.match(/[\s\S]{1,6}/g)) res.write(sseChunk(ch));
    res.write("data: [DONE]\n\n"); res.end();
  });
  await new Promise(r => mock.listen(0, "127.0.0.1", r));
  const port = 3400 + (process.pid % 200);
  BASE = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, API_LIVE_ENABLED: "true", API_BUDGET_DB: path.join(testCache, "budget.sqlite"), API_LLM_DAILY_CALLS: "100", API_LLM_TOTAL_CALLS: "100", API_LLM_DAILY_UNITS: "2000000", API_LLM_TOTAL_UNITS: "2000000", API_LLM_PLAYER_DAILY_CALLS: "100", API_LLM_IP_DAILY_CALLS: "100", API_PLAYER_PER_MINUTE: "100", API_IP_PER_MINUTE: "100", PORT: String(port), HOST: "127.0.0.1", ZHIHU_ACCESS_SECRET: "", ZHIHU_CACHE_DIR: testCache, ZHIHU_KNOWLEDGE_ENABLED: "false", LLM_PROVIDER: "openai", LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}`, LLM_API_KEY: "k", LLM_MODEL: "mock" }
  });
  proc.stderr.on("data", d => { const s = String(d); if (!/ExperimentalWarning/.test(s)) console.error("[server]", s.trim()); });
  for (let i = 0; i < 60; i++) { try { const h = await gj("/api/health"); if (h.json.ok) return; } catch {} await new Promise(r => setTimeout(r, 200)); }
  throw new Error("服务器未能启动");
});

test("/api/health 如实报告降级状态", async () => {
  const { json } = await gj("/api/health");
  assert.equal(json.ok, true);
  assert.equal(json.zhihu, "demo-fallback", "未配 Access Secret 时必须如实标记降级");
  assert.equal(json.llm, "openai");
  assert.equal(json.letters, 3);
});

test("/api/letters 在知乎接口不可用时回落演示数据并标注来源", async () => {
  const { json } = await gj("/api/letters");
  assert.equal(json.letters.length, 3);
  assert.ok(["demo", "cache", "live"].includes(json.hot.source));
  assert.equal(json.hot.source, "demo", "无凭证应回落 demo 快照");
  assert.ok(json.hot.top.length >= 6, "演示热榜条目不足");
  for (const l of json.letters) { assert.ok(l.hot.title, `${l.id} 缺少关联话题`); assert.ok(l.hot.source); }
  assert.equal(json.characters.length, 5);
  assert.equal(json.characters.filter(c => c.summonable).length, 4);
  assert.deepEqual(json.resources, { summons: 2, stamps: 3, unlock: 1, revise: 1 });
});

test("会话不存在返回 404 而非 500", async () => {
  const r = await gj("/api/session/does-not-exist/state");
  assert.equal(r.status, 404);
  assert.match(r.json.error, /会话不存在/);
});

test("完整单局：拆信 → 寻声(SSE) → 落笔(SSE) → 回响(SSE)", async () => {
  const b = (await pj("/api/session", { letterId: "leaving" })).json;
  const id = b.session.id;
  assert.equal(b.session.phase, "sort");
  assert.equal(b.letter.body.length, 9);
  assert.ok(b.liukanshan.opener.length > 10);
  assert.equal(b.liukanshan.hints.length, 4);
  assert.equal(b.chars.silent.name, "南的母亲");
  // 全对拆信
  const types = { s1: "fact", s2: "fact", s3: "clue", s4: "emotion", s5: "bias", s6: "demand", s7: "avoidance", s8: "fact", s9: "emotion" };
  const sr = (await pj(`/api/session/${id}/sort`, { assignments: types })).json;
  assert.equal(sr.result.accuracy, 1);
  assert.equal(sr.session.resources.stamps, 4);
  assert.equal(sr.session.phase, "talk");

  // 召唤 + 提问（LLM 可用 → 文本应来自模型，且事件顺序正确）
  await pj(`/api/session/${id}/summon`, { charId: "silent" });
  mockMode.mode = "ok";
  const ask = await pse(`/api/session/${id}/ask`, { charId: "silent", question: "阿姨，那个租房页面……您最怕的是什么？" });
  assert.equal(ask.order[0], "meta", "首个事件必须是 meta");
  assert.equal(ask.order[ask.order.length - 1], "done", "末个事件必须是 done");
  assert.ok(ask.order.filter(e => e === "delta").length > 1, "应有多个 delta 分片");
  assert.equal(ask.last.meta.attitude, "gentle");
  assert.ok(ask.last.meta.trustDelta > 0);
  assert.equal(ask.last.done.generated, true, "mock 可用时应标记为模型生成");
  assert.equal(ask.last.done.session.talks.at(-1).generated, true, "恢复会话时仍保留真实生成来源");
  assert.ok(ask.last.done.text.includes("模型生成"), "展示文本应为模型输出");
  assert.deepEqual(ask.last.done.receipt, ask.last.done.session.talks.at(-1).receipt);
  assert.equal(ask.last.done.receipt.stamps.delta, -1);
  assert.equal(ask.last.done.receipt.newTruths[0].id, "t1");
  assert.equal(ask.last.done.truth.id, "t1", "真相判定由引擎负责，与 LLM 无关");
  assert.equal(ask.last.done.session.truthsUnlocked.length, 1);

  // 落笔
  const w = (await pj(`/api/session/${id}/write`)).json;
  assert.equal(w.session.phase, "write");
  assert.equal(w.materials.source, "demo");
  assert.ok(w.materials.items.length >= 1);
  assert.ok(w.dataPoints.length >= 2);

  const reply = "南，你好。先说结论：我觉得你可以去杭州，但在那之前，先跟妈妈坐下来谈一次。那个租房页面不是误点，她怕的是自己成了你的负担。offer 的截止日是上周三，你一直没回 HR，其实你已经知道自己想去了。今晚先给 HR 回一封邮件。你已经很不容易了。";
  const rp = await pse(`/api/session/${id}/reply`, { text: reply });
  assert.equal(rp.order[0], "scores");
  assert.equal(rp.order[rp.order.length - 1], "done");
  const sc = rp.last.scores.scores;
  for (const k of ["demand", "accuracy", "warmth", "safety", "community"]) assert.ok(sc[k] >= 0 && sc[k] <= 100, `${k} 越界`);
  assert.ok(sc.demand >= 70);
  assert.equal(rp.last.scores.canRevise, true);
  assert.ok(rp.last.done.review.length > 10, "应有刘看山点评");

  const fin = await pse(`/api/session/${id}/finalize`, {});
  assert.equal(fin.order[0], "ending");
  const e = fin.last.ending;
  assert.ok(["act", "pause", "drift", "backfire"].includes(e.family));
  assert.ok(["full", "partial", "blind"].includes(e.depth));
  assert.ok(e.narrative.length >= 2);
  assert.ok(!e.narrative.join("").includes("{quote}"));
  assert.ok(e.community.upvotes > 0);
  assert.ok(e.community.comments.length >= 3);
  assert.ok(e.card.no && e.card.quoteLabel);
  assert.ok(fin.joined.length > 50, "结局旁白应有流式内容");
});

test("LLM 不可用时自动降级到规则台词，玩法不中断", async () => {
  const b = (await pj("/api/session", { letterId: "third-try" })).json, id = b.session.id;
  await pj(`/api/session/${id}/sort`, { assignments: Object.fromEntries(b.letter.body.map(x => [x.id, "fact"])) });
  await pj(`/api/session/${id}/summon`, { charId: "data" });
  mockMode.mode = "fail";
  const ask = await pse(`/api/session/${id}/ask`, { charId: "data", question: "他一战和二战报的是同一所学校吗？" });
  assert.equal(ask.last.done.generated, false, "LLM 失败应标记为非模型生成");
  assert.ok(ask.last.done.text.length > 20, "必须仍有台词返回");
  assert.equal(ask.last.done.truth.id, "t2", "降级不影响真相解锁");
  assert.ok(ask.order.includes("notice"), "应通知前端已切换为规则台词");
  mockMode.mode = "ok";
});

test("LLM 输出 markdown 被拒，回退规则台词", async () => {
  const b = (await pj("/api/session", { letterId: "colleague" })).json, id = b.session.id;
  await pj(`/api/session/${id}/sort`, { assignments: Object.fromEntries(b.letter.body.map(x => [x.id, "fact"])) });
  await pj(`/api/session/${id}/summon`, { charId: "laozhou" });
  mockMode.mode = "markdown";
  const ask = await pse(`/api/session/${id}/ask`, { charId: "laozhou", question: "你当年厂里那件事，后来怎么了？" });
  assert.equal(ask.last.done.generated, false, "带 markdown 的输出应被判为不合格");
  assert.ok(ask.order.includes("reset"), "应通知前端清空已流出的半截内容");
  assert.ok(!ask.last.done.text.includes("**"));
  mockMode.mode = "ok";
});

test("资源与阶段守卫在 API 层同样生效", async () => {
  const b = (await pj("/api/session", { letterId: "leaving" })).json, id = b.session.id;
  // 未拆信就召唤
  let r = await pj(`/api/session/${id}/summon`, { charId: "laozhou" });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /不在寻声阶段/);
  await pj(`/api/session/${id}/sort`, { assignments: Object.fromEntries(b.letter.body.map(x => [x.id, "fact"])) });
  await pj(`/api/session/${id}/summon`, { charId: "laozhou" });
  await pj(`/api/session/${id}/summon`, { charId: "data" });
  r = await pj(`/api/session/${id}/summon`, { charId: "contrarian" });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /召唤次数已用完/);
  // 空问题
  r = await pj(`/api/session/${id}/ask`, { charId: "laozhou", question: "" });
  assert.equal(r.status, 400);
  // 回信过短
  await pj(`/api/session/${id}/write`);
  r = await pj(`/api/session/${id}/reply`, { text: "好" });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /太短/);
});

test("静态资源可访问且路径穿越被拒", async () => {
  for (const [p, type] of [["/", "text/html"], ["/app.js", "text/javascript"], ["/styles.css", "text/css"], ["/assets/liukanshan.jpg", "image/jpeg"]]) {
    const r = await fetch(BASE + p);
    assert.equal(r.status, 200, p + " 不可访问");
    assert.ok(r.headers.get("content-type").startsWith(type), `${p} 类型应为 ${type}`);
  }
  const bad = await fetch(BASE + "/../server.mjs");
  assert.ok([400, 404].includes(bad.status), "路径穿越应被拒，实际 " + bad.status);
  const miss = await fetch(BASE + "/assets/nope.jpg");
  assert.equal(miss.status, 404);
});

test("三封信各自完整通关：真相全解锁、结局与人格符合预期", async () => {
  const plans = [
    { id: "leaving", sort: { s1: "fact", s2: "fact", s3: "clue", s4: "emotion", s5: "bias", s6: "demand", s7: "avoidance", s8: "fact", s9: "emotion" },
      asks: [["silent", "阿姨，那个租房页面……您心里最怕的是什么？"], ["contrarian", "截止日是上周三，HR 催了两次，她为什么一直没回？"]],
      reply: "南，你好。\n先说结论：我觉得你可以去杭州，但在那之前，先跟妈妈坐下来谈一次。\n那个租房页面不是误点。她想的不是怎么拦住你，而是怕自己成了你的负担。你可以问问她。\n还有，offer 的截止日是上周三，HR 催了两次。我想你其实已经知道自己想去了，只是没敢按下回复键。这不是背叛，这是害怕。\n今晚先给 HR 回一封邮件。明天早上，把租房页面的事问出口。\n你已经很不容易了。两边都疼，两边也都对。" },
    { id: "third-try", sort: { s1: "fact", s2: "bias", s3: "clue", s4: "emotion", s5: "bias", s6: "demand", s7: "avoidance", s8: "fact", s9: "emotion" },
      asks: [["data", "他一战和二战报的是同一所学校吗？"], ["silent", "叔叔，那件反光马甲……您是在跑夜班吗？您最怕什么？"]],
      reply: "阿澈，我知道你很难受。先说结论：我不建议你用同样的方式三战。\n你一战和二战报的不是同一所学校。差 3 分和差 21 分比的不是一样东西，是你的目标涨了一档。\n你爸说供得起，然后半夜叠网约车的马甲。我想他不是供得起，是不想让你知道供不起。去问问他，今晚就去。\n如果还想读研：只考一次、白天兼职、目标改回那所愿意收你的双非。这叫止损，不叫认输。\n你已经很努力了，这一点没有人能否认。" },
    { id: "colleague", sort: { s1: "fact", s2: "fact", s3: "clue", s4: "emotion", s5: "bias", s6: "demand", s7: "avoidance", s8: "fact", s9: "emotion" },
      asks: [["silent", "小陈，那天在楼道里你手抖了一下。你在等什么？"], ["contrarian", "复检单上签的是谁的字？"]],
      reply: "K，你好。\n我想先说一句：你不是坏人，但复检单上是你的签字，抽检时你不在场。这件事你写在第七句，用「其实」开头。我想这才是你说不出口的原因。\n先去楼道找小陈，问他那天为什么手抖。我猜他改数据不是为了自己，是替你把事压下去。\n然后你们一起去质量部，先说自己的那一份流程瑕疵，再说那两批货。主动申报和被查出来，结果差很多。\n这很难。但你已经在里面了，不存在「不说就没事」。你愿意写这封信，说明你还想做对的事。" }
  ];
  for (const p of plans) {
    const b = (await pj("/api/session", { letterId: p.id })).json, id = b.session.id;
    const sr = (await pj(`/api/session/${id}/sort`, { assignments: p.sort })).json;
    assert.equal(sr.result.accuracy, 1, `${p.id} 拆信应全对`);
    assert.equal(sr.result.leads.length, 2, `${p.id} 应拿到两个暗门`);
    for (const [c, q] of p.asks) {
      await pj(`/api/session/${id}/summon`, { charId: c });
      const a = await pse(`/api/session/${id}/ask`, { charId: c, question: q });
      assert.ok(a.last.done.truth, `${p.id} 向 ${c} 的提问应解锁真相，实际未解锁`);
    }
    const st = (await gj(`/api/session/${id}/state`)).json;
    assert.equal(st.session.truthsUnlocked.length, 2, `${p.id} 两层真相都应解锁`);
    await pj(`/api/session/${id}/write`);
    const rp = await pse(`/api/session/${id}/reply`, { text: p.reply });
    const sc = rp.last.scores.scores;
    assert.ok(sc.accuracy >= 80, `${p.id} 用上两层真相后事实准确度应高，实际 ${sc.accuracy}`);
    assert.ok(sc.safety >= 70, `${p.id} 这封回信不该被判为高风险，实际 ${sc.safety}`);
    const fin = (await pse(`/api/session/${id}/finalize`, {})).last.ending;
    assert.equal(fin.depth, "full", `${p.id} 应达到 full 深度，实际 ${fin.depth}`);
    assert.ok(["pause", "act"].includes(fin.family), `${p.id} 应导向 pause/act，实际 ${fin.family}`);
    assert.equal(fin.missed.length, 0, `${p.id} 不该有遗漏的真相`);
    assert.equal(fin.quoteRisky, false, `${p.id} 金句不该被标记为风险`);
    assert.ok(fin.community.upvotes > 300, `${p.id} 优质回信应有高赞，实际 ${fin.community.upvotes}`);
    assert.ok(!fin.community.twist, `${p.id} 看全真相不该触发反转`);
  }
});

test("参考台服务链路：来源归属、搜索限额、笔记保存与封存回执", async () => {
  const { json: created } = await pj("/api/session", { letterId: "leaving" }); const root = `/api/session/${created.session.id}`;
  assert.equal((await gj(root + "/research")).status, 400);
  await pj(root + "/sort", { assignments: Object.fromEntries(created.letter.body.map(b => [b.id, "fact"])) });
  const before = (await gj(root + "/state")).json.session;
  const desk = await gj(root + "/research"); assert.equal(desk.status, 200); assert.equal(desk.json.queriesLeft, 3);
  const card = desk.json.cards.find(c => c.source === "demo"); assert.ok(card);
  const forged = await pj(root + "/research-note", { id: "__proto__", mode: "support", reflection: "伪造来源不应该被允许保存。" }); assert.equal(forged.status, 400);
  const reflection = "这只是相似经历，不能推断南的妈妈也抱有同样的想法。";
  const saved = await pj(root + "/research-note", { id: card.id, mode: "question", reflection, title: "伪造标题", source: "live" });
  assert.equal(saved.status, 200); assert.equal(saved.json.notes[0].title, card.title); assert.equal(saved.json.notes[0].source, "demo");
  assert.deepEqual((await gj(root + "/state")).json.session, before);
  const search = await pj(root + "/research-search", { query: "异地工作亲子边界" }); assert.equal(search.status, 200); assert.equal(search.json.queriesLeft, 2); assert.equal(search.json.fallbackReason, "NO_SECRET");
  await pj(root + "/write");
  await pse(root + "/reply", { text: "南，你已经很不容易了。我想先和你确认自己的意愿，再跟妈妈坐下来谈一次。这些社区经验不能代替你的决定。" });
  assert.equal((await pj(root + "/research-note", { id: card.id, remove: true })).status, 400);
  const end = (await pse(root + "/finalize", {})).last.ending;
  assert.equal(end.research.notes[0].reflection, reflection); assert.equal(end.research.liveReferences, 0); assert.equal(end.community.source, "simulation");
  assert.ok(end.community.comments.some(c => c.author === "资料旁观者（模拟）"));
});

test("平行试写 API：寄出前拒绝，寄出后可比较且正式档案不变", async () => {
  const created = (await pj("/api/session", { letterId: "leaving" })).json;
  const root = `/api/session/${created.session.id}`;
  const alternative = "你就是自私，必须马上离开！直接断绝关系，以后永远不要回家，不用再管她。";
  assert.equal((await pj(root + "/rehearsal", { text: alternative })).status, 400);
  await pj(root + "/sort", { assignments: Object.fromEntries(created.letter.body.map(b => [b.id, "fact"])) }); await pj(root + "/write");
  await pse(root + "/reply", { text: "南，你已经很不容易了。我建议先和妈妈坐下来谈一次，听听她在担心什么。今晚可以先回复HR，确认offer是否还有效。" });
  await pse(root + "/finalize", {});
  const before = (await gj(root + "/state")).json;
  const result = await pj(root + "/rehearsal", { text: alternative });
  assert.equal(result.status, 200); assert.equal(result.json.simulation, true); assert.equal(result.json.generated, false);
  assert.equal(result.json.alternate.family, "backfire"); assert.ok(result.json.delta.safety < 0);
  assert.deepEqual((await gj(root + "/state")).json, before);
});

test("收尾：关闭服务器与 mock", async () => {
  proc.kill();
  await new Promise(r => mock.close(r));
  assert.ok(true);
});
