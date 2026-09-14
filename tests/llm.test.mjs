// LLM 增强路径测试：用本地 mock 的 OpenAI 兼容端点，验证流式解析、事实骨架约束与三种降级
import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import * as E from "../lib/engine.mjs";

// mock 端点必须在 import lib/llm.mjs 之前配好环境变量（llm.mjs 在模块加载时读取）
function startMock(handler) {
  return new Promise(resolve => {
    const srv = http.createServer(handler);
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}
const sseChunk = (content) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;

let mock, llm;
const state = { mode: "ok", calls: 0, blockedExternal: 0, requests: [] };
const originalFetch = globalThis.fetch, localOrigins = new Set();
after(async () => {
  globalThis.fetch = originalFetch;
  if (mock) { mock.srv.closeAllConnections(); await new Promise(r => mock.srv.close(r)); }
});

test("准备 mock LLM 端点", async () => {
  mock = await startMock(async (req, res) => {
    state.calls++;
    let body = ""; for await (const chunk of req) body += chunk;
    state.requests.push(JSON.parse(body));
    if (state.mode === "http500") { res.writeHead(500, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { message: "boom" } })); }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (state.mode === "hang") return; // 永不响应，触发超时
    if (["eof", "invalid-json", "json-error", "midstream-error"].includes(state.mode)) {
      res.write(sseChunk("开头还好"));
      if (state.mode === "eof") return res.end();
      if (state.mode === "invalid-json") return res.end("data: {broken\n\ndata: [DONE]\n\n");
      if (state.mode === "json-error") return res.end(`data: ${JSON.stringify({ error: { message: "JSON provider failure" } })}\n\ndata: [DONE]\n\n`);
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
  process.env.LLM_PROVIDER = "openai";
  Object.assign(process.env, { API_LLM_UNLIMITED: "false", API_MAX_CONCURRENT: "3", API_LLM_MAX_OUTPUT_TOKENS: "800", API_LLM_MAX_INPUT_BYTES: "24000" });
  localOrigins.add(process.env.LLM_BASE_URL);
  globalThis.fetch = (input, options) => {
    const url = new URL(input);
    if (!localOrigins.has(url.origin)) { state.blockedExternal++; throw new Error("测试禁止外部网络"); }
    return originalFetch(input, options);
  };
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
  assert.ok(u.includes("没看到的真相"), "结束复盘已公开的遗漏真相可作为结局暗示素材");
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



test("截断流必须抛错，不能把没有完成标记的半截文本标成成功", async () => {
  state.mode = "eof";
  const deltas = [];
  await assert.rejects(async () => {
    for await (const delta of llm.streamChat([{ role: "user", content: "hi" }])) deltas.push(delta);
  }, { code: "LLM_INCOMPLETE" });
  assert.deepEqual(deltas, ["开头还好"]);
  const { budget } = await import("../lib/budget.mjs");
  assert.equal(budget.snapshot().active, 0);
});

test("流错误含 JSON 字样也必须降级，不能吞掉错误", async () => {
  state.mode = "json-error";
  await assert.rejects(() => llm.completeChat([{ role: "user", content: "hi" }]), /JSON provider failure/);
});

test("损坏的流事件必须降级", async () => {
  state.mode = "invalid-json";
  await assert.rejects(() => llm.completeChat([{ role: "user", content: "hi" }]), SyntaxError);
});

// 启动未修改的 server；仅注入网络白名单和测试用短超时，不读取环境密钥或落盘额度。
async function startLocalGame(t, mode) {
  const env = {
    SystemRoot: process.env.SystemRoot, HOST: "127.0.0.1", PORT: "0",
    LLM_PROVIDER: "openai", LLM_API_KEY: mode === "no-key" ? "" : "local-only",
    LLM_BASE_URL: process.env.LLM_BASE_URL, LLM_MODEL: "local-mock",
    API_LIVE_ENABLED: "true", API_BUDGET_DB: ":memory:",
    API_LLM_DAILY_CALLS: "100", API_LLM_TOTAL_CALLS: "100", API_LLM_DAILY_UNITS: "1000000", API_LLM_TOTAL_UNITS: "1000000",
    API_LLM_PLAYER_DAILY_CALLS: "100", API_LLM_IP_DAILY_CALLS: "100", API_PLAYER_PER_MINUTE: "100", API_IP_PER_MINUTE: "100",
    ZHIHU_ACCESS_SECRET: "", ZHIHU_KNOWLEDGE_ENABLED: "false", ZHIHU_PERSONALIZATION_ENABLED: "false",
    ZHIHU_OAUTH_APP_ID: "", ZHIHU_OAUTH_APP_KEY: "", ZHIHU_OAUTH_REDIRECT_URI: "",
    // 不创建目录：无凭据只读演示包，不读取工作区缓存。
    ZHIHU_CACHE_DIR: path.join(tmpdir(), `echo-p2-2-unused-${process.pid}-${mode}`)
  };
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import http from "node:http";
    const original = globalThis.fetch, listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function (...args) {
      this.once("listening", () => process.send({ type: "ready", port: this.address().port }));
      return listen.apply(this, args);
    };
    globalThis.fetch = (input, options = {}) => {
      if (new URL(input).origin !== process.env.LLM_BASE_URL) {
        process.send({ type: "blocked-external" });
        throw new Error("External network disabled in P2-2 test");
      }
      // 单测覆盖适配层自身 timer；此处只缩短服务层挂起测试的等待时间。
      const signal = ${JSON.stringify(mode)} === "hang" ? AbortSignal.any([options.signal, AbortSignal.timeout(120)]) : options.signal;
      return original(input, { ...options, signal });
    };
    await import("./server.mjs");
  `], { cwd: new URL("..", import.meta.url), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let stderr = "";
  child.stdout.resume(); child.stderr.on("data", d => { stderr += d; });
  child.on("message", m => { if (m.type === "blocked-external") state.blockedExternal++; });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    assert.doesNotMatch(stderr, /Error:/, stderr);
  });
  const [ready] = await once(child, "message", { signal: AbortSignal.timeout(5000) });
  assert.equal(ready.type, "ready");
  const base = `http://127.0.0.1:${ready.port}`; localOrigins.add(base);
  t.after(() => localOrigins.delete(base));
  let cookie = "";
  return async (route, payload) => {
    const response = await fetch(base + route, {
      method: payload === undefined ? "GET" : "POST", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
    const text = await response.text();
    assert.equal(response.status, 200, text);
    if (!response.headers.get("content-type").includes("text/event-stream")) return JSON.parse(text);
    const events = [], last = {}; let visible = "";
    for (const m of text.matchAll(/event: (\w+)\ndata: (.*)/g)) {
      const data = JSON.parse(m[2]); events.push(m[1]); last[m[1]] = data;
      if (m[1] === "reset") visible = "";
      if (m[1] === "delta") visible += data;
    }
    return { events, last, visible };
  };
}

test("三封信本地服务降级：无 Key/超时/中途流错/截断均可完整通关", { timeout: 90000 }, async t => {
  for (const mode of ["no-key", "hang", "midstream-error", "eof"]) {
    await t.test(mode, async t => {
      state.mode = mode;
      const request = await startLocalGame(t, mode), beforeCalls = state.calls;
      assert.equal((await request("/api/health")).llm, mode === "no-key" ? "none" : "openai");
      for (const letter of Object.values(E.LETTERS)) {
        const created = await request("/api/session", { letterId: letter.id });
        const root = `/api/session/${created.session.id}`, expected = E.createSession(letter.id, created.session.id);
        const assignments = Object.fromEntries(letter.body.map(b => [b.id, b.type]));
        await request(root + "/sort", { assignments }); E.applySorting(expected, assignments);
        await request(root + "/summon", { charId: "silent" }); E.summon(expected, "silent");
        const question = "可以听听您的想法吗？", wireStart = state.requests.length;
        const talk = E.ask(expected, "silent", question);
        const ask = await request(root + "/ask", { charId: "silent", question });
        assert.equal(ask.last.done.generated, false);
        assert.equal(ask.last.done.text, talk.a);
        assert.equal(ask.visible, talk.a);
        assert.deepEqual(ask.last.done.session.resources, expected.resources);
        assert.equal(ask.last.done.session.talks.at(-1).generated, false);
        assert.equal(expected.truthsUnlocked.length, 0);
        const writing = await request(root + "/write", {}); E.enterWrite(expected);
        assert.equal(writing.materials.source, "demo");
        const reply = "我理解你的难处，今晚可以先听听彼此的想法，不必立刻决定。";
        const feedback = E.submitReply(expected, reply), reviewed = await request(root + "/reply", { text: reply });
        assert.deepEqual(reviewed.last.scores.scores, feedback.scores);
        assert.equal(reviewed.last.done.generated, false);
        assert.equal(reviewed.visible, `嗐，我看完了。${feedback.feedback.text}`);
        // 对真正发送到 mock 的调查/点评请求检查隐藏真相，不仅测试 prompt 工厂。
        for (const wire of state.requests.slice(wireStart)) {
          for (const truth of letter.truths) assert.ok(!JSON.stringify(wire.messages).includes(truth.text));
        }
        const ending = E.finalize(expected), finalized = await request(root + "/finalize", {});
        assert.equal(finalized.last.done.generated, false);
        assert.equal(finalized.events[0], "ending", "规则复盘在任何模型 delta 前公开");
        assert.equal(finalized.visible.trim(), ending.narrative.join("\n\n"));
        assert.deepEqual(finalized.last.ending.missed, ending.missed);
        const restored = await request(root + "/state");
        assert.equal(restored.session.phase, "echo");
        assert.equal(restored.session.endingResult.generated, false);
        assert.equal(restored.session.endingResult.finalText, ending.narrative.join("\n\n"));
        assert.deepEqual(restored.session.resources, expected.resources);
        for (const stream of [ask, reviewed, finalized]) {
          assert.equal(stream.events.at(-1), "done");
          assert.equal(stream.events.includes("reset"), ["midstream-error", "eof"].includes(mode));
          if (mode !== "no-key") assert.ok(stream.events.includes("notice"));
          assert.ok(!stream.visible.includes("开头还好"), "最终规则文本不能混入失败的 AI 片段");
        }
      }
      assert.equal(state.calls - beforeCalls, mode === "no-key" ? 0 : 9);
      t.diagnostic(`${mode}：3 封信完成，LLM 本地 mock ${state.calls - beforeCalls} 次，实际外部调用 0。`);
    });
  }
});

test("网络审计：仅本地 mock，实际外部调用 0", t => {
  assert.equal(state.blockedExternal, 0);
  t.diagnostic(`本地 mock 请求 ${state.calls}；外部请求尝试 ${state.blockedExternal}；实际外部调用 0；非真实 AI 验收。`);
});
