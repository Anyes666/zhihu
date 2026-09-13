// LLM 增强路径测试：用本地 mock 的 OpenAI 兼容端点，验证流式解析、事实骨架约束与三种降级
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// mock 端点必须在 import lib/llm.mjs 之前配好环境变量（llm.mjs 在模块加载时读取）
function startMock(handler) {
  return new Promise(resolve => {
    const srv = http.createServer(handler);
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}
const sseChunk = (content) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;

let mock, llm;
const state = { mode: "ok", calls: 0 };

test("准备 mock LLM 端点", async () => {
  mock = await startMock(async (req, res) => {
    state.calls++;
    if (state.mode === "http500") { res.writeHead(500, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { message: "boom" } })); }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (state.mode === "hang") return; // 永不响应，触发超时
    if (state.mode === "midstream-error") {
      res.write(sseChunk("开头还好"));
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "error" }], error: { message: "internal_error" } })}\n\n`);
      res.write("data: [DONE]\n\n"); return res.end();
    }
    const text = state.mode === "oversize" ? "界".repeat(10000) : state.mode === "markdown" ? "**先说结论**\n- 一\n- 二" : state.mode === "tooshort" ? "嗯。" : "……那个页面不是误点。我在看杭州的房子，想知道她一个月要花多少钱，我这边能不能帮上。";
    res.write(": keep-alive\n\n"); // 服务端心跳注释，解析器必须忽略
    for (const ch of text.match(/[\s\S]{1,5}/g)) res.write(sseChunk(ch));
    res.write("data: [DONE]\n\n"); res.end();
  });
  process.env.LLM_BASE_URL = `http://127.0.0.1:${mock.port}`;
  process.env.LLM_API_KEY = "test-key";
  delete process.env.ZHIHU_ACCESS_SECRET;
  Object.assign(process.env, { API_LIVE_ENABLED: "true", API_BUDGET_DB: ":memory:", API_LLM_DAILY_CALLS: "100", API_LLM_TOTAL_CALLS: "100",
    API_LLM_DAILY_UNITS: "1000000", API_LLM_TOTAL_UNITS: "1000000", API_LLM_PLAYER_DAILY_CALLS: "100", API_LLM_IP_DAILY_CALLS: "100", API_PLAYER_PER_MINUTE: "100", API_IP_PER_MINUTE: "100" });
  llm = await import("../lib/llm.mjs");
  assert.equal(llm.llmProvider(), "openai");
});

test("流式解析：忽略心跳注释，拼出完整文本", async () => {
  state.mode = "ok";
  const out = await llm.completeChat([{ role: "user", content: "hi" }], { timeoutMs: 5000 });
  assert.ok(out.includes("不是误点"), "应拼出完整回复：" + out);
  assert.ok(!out.includes("keep-alive"), "不应把心跳注释当内容");
});

test("超时：挂起的端点在 timeoutMs 内抛错，不会无限等待", async () => {
  state.mode = "hang";
  const t0 = Date.now();
  await assert.rejects(() => llm.completeChat([{ role: "user", content: "hi" }], { timeoutMs: 700 }));
  const dt = Date.now() - t0;
  assert.ok(dt < 4000, `应在超时后尽快返回，实际 ${dt}ms`);
});

test("HTTP 错误与流中错误都被抛出，交由调用方降级", async () => {
  state.mode = "http500";
  await assert.rejects(() => llm.completeChat([{ role: "user", content: "hi" }], { timeoutMs: 3000 }), /500|boom/);
  state.mode = "midstream-error";
  await assert.rejects(() => llm.completeChat([{ role: "user", content: "hi" }], { timeoutMs: 3000 }), /internal_error/);
});

test("Prompt 框架：角色 prompt 必含事实骨架，且按是否可透露真相切换约束", () => {
  const E = { title: "离开的人", from: "南", body: [{ text: "第一句" }, { text: "第二句" }] };
  const char = { id: "silent", systemPrompt: "你话很少。" };
  const withTruth = llm.characterMessages({ char, letter: E, question: "您最怕什么？", attitude: "温和", skeleton: "骨架台词", truth: { text: "隐藏真相内容" }, history: [], materials: [] });
  const sys = withTruth[0].content;
  assert.ok(sys.includes("骨架台词"), "必须注入事实骨架");
  assert.ok(sys.includes("隐藏真相内容"), "可透露时应把真相交给模型");
  assert.ok(sys.includes("唯一的事实来源"), "必须声明骨架是唯一事实来源");
  assert.equal(withTruth[withTruth.length - 1].content, "您最怕什么？");

  const without = llm.characterMessages({ char, letter: E, question: "她在想什么？", attitude: "中性", skeleton: "骨架台词", truth: null, history: [], materials: [] })[0].content;
  assert.ok(/不能.*透露/.test(without), "不可透露时必须明确禁止");
  assert.ok(!without.includes("隐藏真相内容"));
});

test("Prompt 框架：多轮历史与知乎素材按序注入", () => {
  const msgs = llm.characterMessages({
    char: { id: "laozhou", systemPrompt: "你是老周。" }, letter: { title: "T", from: "F", body: [{ text: "x" }] },
    question: "然后呢？", attitude: "温和", skeleton: "骨架", truth: null,
    history: [{ q: "第一问", a: "第一答" }, { q: "第二问", a: "第二答" }],
    materials: [{ author: "某答主", text: "社区观点片段" }]
  });
  assert.equal(msgs[0].role, "system");
  assert.ok(!msgs[0].content.includes("社区观点片段"), "外部素材不能进入系统指令");
  assert.ok(msgs.at(-2).content.includes("社区观点片段") && msgs.at(-2).content.includes("不可信参考"));
  const roles = msgs.map(m => m.role).join(",");
  assert.equal(roles, "system,user,assistant,user,assistant,user,user");
  assert.equal(msgs[1].content, "第一问");
  assert.equal(msgs[msgs.length - 1].content, "然后呢？");
});

test("结局旁白 prompt 携带大纲与金句，并要求不得改变结局性质", () => {
  const msgs = llm.endingMessages({
    letter: { title: "离开的人", from: "南", body: [] }, reply: "我的回信",
    ending: { familyLabel: "她先停下来了", depthLabel: "你看见了信的全部", narrative: ["第一段大纲", "第二段大纲"] },
    quote: "一句金句", missed: [{ text: "没看到的真相" }]
  });
  const u = msgs[1].content;
  assert.ok(u.includes("第一段大纲") && u.includes("第二段大纲"), "必须传入结局大纲");
  assert.ok(u.includes("一句金句"));
  assert.ok(u.includes("没看到的真相"), "未解锁真相应作为暗示素材");
  assert.ok(/不能改变结局性质/.test(msgs[0].content));
});

test("输入/输出保护：过大输入不请求上游，过大输出取消流且保留预留消耗", async () => {
  const { budget } = await import("../lib/budget.mjs");
  const calls = state.calls;
  await assert.rejects(() => llm.completeChat([{ role: "user", content: "界".repeat(10000) }]), { code: "BUDGET_INPUT" });
  assert.equal(state.calls, calls);
  const before = budget.snapshot().usage.find(x => x.kind === "llm").totalCalls;
  state.mode = "oversize";
  await assert.rejects(() => llm.completeChat([{ role: "user", content: "你好" }]), { code: "BUDGET_OUTPUT" });
  assert.equal(budget.snapshot().usage.find(x => x.kind === "llm").totalCalls, before + 1);
  assert.equal(budget.snapshot().active, 0);
});

test("收尾：关闭 mock", async () => {
  await new Promise(r => mock.srv.close(r));
  assert.ok(true);
});
