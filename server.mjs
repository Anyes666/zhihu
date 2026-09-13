// 回声邮局 · 服务端：静态资源 + 游戏 API（会话内存态）+ 知乎生态适配 + LLM 流式增强
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import * as E from "./lib/engine.mjs";
import * as Z from "./lib/zhihu.mjs";
import * as LLM from "./lib/llm.mjs";
import * as R from "./lib/research.mjs";
import { rehearseReply } from "./lib/rehearsal.mjs";
import { createOAuth } from "./lib/oauth.mjs";
import { budget, budgetMessage, runBudgetContext } from "./lib/budget.mjs";

const root = path.dirname(fileURLToPath(import.meta.url)), pub = path.join(root, "public");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2" };
const sessions = new Map();
const oauth = createOAuth();
const SESSION_TTL = 6 * 60 * 60e3;
setInterval(() => { const now = Date.now(); for (const [k, s] of sessions) if (now - s.createdAt > SESSION_TTL) sessions.delete(k); }, 10 * 60e3).unref();

const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
const fail = (res, e, code = 400) => json(res, code, { error: e.message || String(e) });
async function body(req) { let raw = ""; for await (const c of req) { raw += c; if (raw.length > 64e3) throw new Error("请求体过大"); } return raw ? JSON.parse(raw) : {}; }
function getSession(id) { const s = sessions.get(id); if (!s) throw Object.assign(new Error("会话不存在或已过期，请重新开始"), { status: 404 }); return s; }
function bundle(s) { const letter = E.LETTERS[s.letterId]; const lk = letter.lines.liukanshan; return { session: E.publicState(s), letter: E.letterView(letter, s), liukanshan: { opener: lk.opener, hints: lk.hints, norms: lk.norms }, chars: letter.chars }; }
function sse(res) { res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" }); return (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }

// 素材缓存（每封信一次搜索，供角色对话与评论区使用）
async function materials(letter) {
  return Z.search(letter.searchQuery, 6, "search_" + letter.id);
}

// 把角色的规则回复用 LLM 润色并流式输出；LLM 不可用/超时则直接流式输出规则回复
async function streamCharacterReply({ send, session, letter, char, talk, question }) {
  const skeleton = talk.a;
  const truth = talk.truthRevealed ? letter.truths.find(t => t.id === talk.truthRevealed) : null;
  const history = session.talks.filter(t => t.char === char.id && t !== talk).slice(-3);
  let mat = []; try { const result = await materials(letter); mat = result.items.slice(0, 3).map(item => ({ ...item, source: result.source, fetchedAt: result.fetchedAt })); } catch {}
  let out = "", ok = false;
  if (LLM.llmProvider() !== "none" && !talk.left) {
    try {
      const msgs = LLM.characterMessages({ char, letter, question, attitude: E.ATTITUDE_LABEL[talk.attitude], skeleton, truth, history, materials: mat.map(m => ({ ...m })), mood: session.mood?.[char.id], memory: history.map(h => `${h.attitude}/${h.mood || "guarded"}: ${h.q} -> ${h.a}`).join("\n") });
      for await (const d of LLM.streamChat(msgs, { timeoutMs: 9000 })) { out += d; send("delta", d); }
      ok = out.replace(/\s/g, "").length >= 12 && !/\[|\]|\*\*|^#/.test(out);
    } catch (e) { send("notice", { text: budgetMessage(e.code), code: e.code || "LLM_FAIL" }); }
  }
  if (!ok) { if (out) send("reset", {}); out = skeleton; for (const chunk of skeleton.match(/[\s\S]{1,6}/g) || []) { send("delta", chunk); await new Promise(r => setTimeout(r, 18)); } }
  else { talk.a = out; } // 记录最终展示文本（事实骨架仍在 skeleton）
  talk.skeleton = skeleton; talk.generated = ok;
  return { text: out, generated: ok };
}

async function handleRequest(req, res) {
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = u.pathname;
  try {
    if (await oauth.handle(req, res)) return;
    if (p.startsWith("/api/")) {
      // ---- 元信息 ----
      if (p === "/api/health") return json(res, 200, { ok: true, project: "echo-post", zhihu: Z.zhihuConfigured() ? "live" : "demo-fallback", llm: LLM.llmProvider(), budget: budget.status(), capabilities: Z.capabilityStatus(), letters: Object.keys(E.LETTERS).length, sessions: sessions.size });
      if (p === "/api/letters" && req.method === "GET") {
        const hot = await Z.hotList(30);
        const letters = Object.values(E.LETTERS).map(l => {
          const m = Z.matchHot(hot.items, l.hotQuery);
          return { id: l.id, title: l.title, from: l.from, time: l.time, tags: l.tags, summary: l.summary, hot: m ? { title: m.title, url: m.url, source: hot.source } : { ...l.hotFallback, source: "fallback" } };
        });
        return json(res, 200, { letters, hot: { source: hot.source, fetchedAt: hot.fetchedAt, stale: hot.stale, fallbackReason: hot.fallbackReason, count: hot.items.length, error: hot.error || null, top: hot.items.slice(0, 8) }, categories: E.CATEGORIES, characters: Object.values(E.CHARACTERS).map(c => ({ id: c.id, name: c.name, role: c.role, summonable: c.summonable, portrait: c.portrait, tagline: c.tagline, stance: c.stance, strengths: c.strengths, weaknesses: c.weaknesses })), resources: E.RESOURCES });
      }
      // ---- 会话 ----
      if (p === "/api/session" && req.method === "POST") {
        const { letterId } = await body(req);
        if (sessions.size >= 2000) throw Object.assign(new Error("邮局当前接待人数较多，请稍后再开新局。已有进度仍可继续。"), { status: 429 });
        const id = randomUUID(); const s = E.createSession(letterId, id); sessions.set(id, s);
        const letter = E.LETTERS[letterId];
        return json(res, 200, bundle(s));
      }
      const m = p.match(/^\/api\/session\/([\w-]+)\/([\w-]+)$/);
      if (m) {
        const s = getSession(m[1]), action = m[2], letter = E.LETTERS[s.letterId];
        if (action === "rehearsal" && req.method === "POST") return json(res, 200, rehearseReply(s, (await body(req)).text));
        if (action === "state" && req.method === "GET") return json(res, 200, bundle(s));
        if (action === "materials" && req.method === "GET") { const mat = await materials(letter); return json(res, 200, { ...mat, items: mat.items.slice(0, 3) }); }
        if (action === "research" && req.method === "GET") {
          if (!["talk", "write", "revise", "review", "echo"].includes(s.phase)) throw new Error("先拆信，再查阅资料");
          const [search, knowledge] = await Promise.all([materials(letter), Z.knowledgeList()]);
          const cards = [...R.rememberSources(s, search), ...R.rememberSources(s, knowledge)];
          return json(res, 200, { cards, notes: R.researchState(s).notes, queriesLeft: 3 - R.researchState(s).queries.length,
            channels: [search, knowledge].map(({ capability, source, fetchedAt, stale, fallbackReason }) => ({ capability, source, fetchedAt, stale, fallbackReason })) });
        }
        if (action === "research-search" && req.method === "POST") {
          const query = R.reserveQuery(s, (await body(req)).query);
          const result = await Z.search(query, 6);
          return json(res, 200, { ...result, items: undefined, cards: R.rememberSources(s, result), queriesLeft: 3 - R.researchState(s).queries.length });
        }
        if (action === "research-note" && req.method === "POST") {
          const input = await body(req);
          const notes = input.remove ? R.removeNote(s, input.id) : R.saveNote(s, input);
          return json(res, 200, { notes });
        }
        if (action === "sort" && req.method === "POST") { const { assignments } = await body(req); const r = E.applySorting(s, assignments); return json(res, 200, { result: r, session: E.publicState(s) }); }
        if (action === "summon" && req.method === "POST") { const { charId } = await body(req); const r = E.summon(s, charId); return json(res, 200, { result: r, session: E.publicState(s) }); }
        if (action === "ask" && req.method === "POST") {
          const { charId, question } = await body(req);
          if (!question || String(question).trim().length < 2) throw new Error("请输入问题");
          const normalized = String(question).slice(0, 300);
          if (s.phase === "talk" && s.askReplay?.charId === charId && s.askReplay.question === normalized) {
            const send = sse(res); send("meta", s.askReplay.meta); send("delta", s.askReplay.done.text);
            send("done", { ...s.askReplay.done, session: E.publicState(s), replayed: true }); return res.end();
          }
          const talk = E.ask(s, charId, normalized);
          const send = sse(res);
          const meta = { attitude: talk.attitude, attitudeLabel: E.ATTITUDE_LABEL[talk.attitude], trustDelta: talk.trustDelta, trust: talk.trust, left: talk.left, resources: talk.resources, name: talk.name, mood: talk.mood };
          send("meta", meta);
          const char = E.CHARACTERS[charId];
          const sessionTalk = s.talks[s.talks.length - 1];
          const { generated } = await streamCharacterReply({ send, session: s, letter, char, talk: sessionTalk, question: normalized });
          const done = { text: sessionTalk.a, generated, truth: talk.truth, session: E.publicState(s) };
          s.askReplay = { charId, question: normalized, meta: structuredClone(meta), done };
          send("done", done);
          return res.end();
        }
        if (action === "unlock" && req.method === "POST") { const r = E.unlockTruth(s); return json(res, 200, { result: r, session: E.publicState(s) }); }
        if (action === "write" && req.method === "POST") { E.enterWrite(s); let mat = { items: [], source: "none" }; try { mat = await materials(letter); } catch {} return json(res, 200, { session: E.publicState(s), materials: { ...mat, items: mat.items.slice(0, 3) }, dataPoints: letter.dataPoints, dimensions: E.DIMENSIONS }); }
        if (action === "reply" && req.method === "POST") {
          const { text } = await body(req);
          if (s.phase === "review" && s.reviewResult?.input === text) {
            const send = sse(res); send("scores", { ...s.reviewResult.scores, session: E.publicState(s) });
            send("delta", s.reviewResult.done.review); send("done", { ...s.reviewResult.done, replayed: true }); return res.end();
          }
          const r = E.submitReply(s, text);
          const send = sse(res);
          send("scores", { ...r, session: E.publicState(s), dimensions: E.DIMENSIONS });
          // 刘看山点评：LLM 增强，失败则用规则反馈
          let out = "", ok = false;
          if (LLM.llmProvider() !== "none") {
            try { for await (const d of LLM.streamChat(LLM.reviewMessages({ letter, reply: text, scores: r.scores, feedback: r.feedback, truthsUnlocked: E.publicState(s).truthsUnlocked, references: R.researchReceipt(s).notes }), { timeoutMs: 9000 })) { out += d; send("delta", d); } ok = out.length > 20; } catch (e) { send("notice", { text: budgetMessage(e.code), code: e.code || "LLM_FAIL" }); }
          }
          if (!ok) { if (out) send("reset", {}); const fb = `嗐，我看完了。${r.feedback.text}`; for (const c of fb.match(/[\s\S]{1,6}/g)) { send("delta", c); await new Promise(rs => setTimeout(rs, 16)); } out = fb; }
          const done = { review: out, generated: ok };
          s.reviewResult = { input: text, scores: { ...r, dimensions: E.DIMENSIONS }, done };
          send("done", done);
          return res.end();
        }
        if (action === "revise" && req.method === "POST") { const r = E.requestRevise(s); return json(res, 200, { result: r, session: E.publicState(s) }); }
        if (action === "finalize" && req.method === "POST") {
          if (s.phase === "echo" && s.endingResult) {
            const send = sse(res); send("ending", s.endingResult); send("delta", s.endingResult.finalText);
            send("done", { generated: s.endingResult.generated, replayed: true }); return res.end();
          }
          if (s.phase !== "review") throw new Error("请先寄出回信");
          let echoes = []; try { const mat = await materials(letter); echoes = mat.items.slice(0, 3).map(i => ({ ...i, source: mat.source, fetchedAt: mat.fetchedAt, stale: mat.stale })); } catch {}
          const ending = E.finalize(s, echoes);
          ending.research = R.researchReceipt(s);
          if (ending.research.notes.length) ending.community.comments.push({ author: "资料旁观者（模拟）", votes: 0, text: "你为「" + ending.research.notes[0].title + "」写下了适用边界。读过资料不等于证实了来信，别忘了向当事人确认。" });
          ending.community.source = "simulation";
          // Preserve the sealed result immediately, including a complete rules fallback
          // while model streaming is in progress. GET state never finalizes again.
          s.endingResult = { ...ending, finalText: ending.narrative.join("\n\n"), generated: false, generationPending: true };
          const send = sse(res);
          send("ending", ending);
          let out = "", ok = false;
          if (LLM.llmProvider() !== "none") {
            try { for await (const d of LLM.streamChat(LLM.endingMessages({ letter, reply: s.reply.text, ending, quote: ending.quote, missed: ending.missed, references: ending.research.notes, interactions: s.talks.map(t => `${t.name}（${t.mood || "guarded"}）：${t.q}`).join("；") }), { timeoutMs: 12000 })) { out += d; send("delta", d); } ok = out.length > 80; } catch (e) { send("notice", { text: budgetMessage(e.code), code: e.code || "LLM_FAIL" }); }
          }
          if (!ok) { if (out) send("reset", {}); for (const para of ending.narrative) { for (const c of para.match(/[\s\S]{1,8}/g)) { send("delta", c); await new Promise(rs => setTimeout(rs, 14)); } send("delta", "\n\n"); } }
          s.endingResult = { ...ending, finalText: ok ? out : ending.narrative.join("\n\n"), generated: ok, generationPending: false };
          send("done", { generated: ok });
          return res.end();
        }
      }
      return json(res, 404, { error: "接口不存在" });
    }
    if (req.method !== "GET") { res.writeHead(405); return res.end(); }
    const rel = p === "/" ? "/index.html" : decodeURIComponent(p), fp = path.resolve(pub, "." + rel);
    if (!fp.startsWith(pub) || !existsSync(fp)) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(fp);
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": ext === ".html" || ext === ".js" || ext === ".css" ? "no-store" : "public, max-age=86400" });
    res.end(await readFile(fp));
  } catch (e) { if (res.headersSent) { try { res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`); } catch {} return res.end(); } fail(res, e, e.status || 400); }
}

// Serialize mutations per game before any await: double clicks and overlapping finalize
// requests cannot trigger concurrent generation. Completed retries replay the saved result.
const sessionLocks = new Set();
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname.startsWith("/api/") && req.headers["sec-fetch-site"] === "cross-site") return json(res, 403, { error: "请从邮局页面发起操作。" });
  if (pathname.startsWith("/api/") && req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: "请从邮局页面发起操作。" }); }
    catch { return json(res, 403, { error: "请求来源无效。" }); }
  }
  const mutation = req.method === "POST" ? pathname.match(/^\/api\/session\/([\w-]+)\//)?.[1] : null;
  if (mutation && sessionLocks.has(mutation)) return json(res, 409, { error: "上一条操作仍在处理，请稍后重试。不会重复消耗资源。" });
  if (mutation) sessionLocks.add(mutation);
  const controller = new AbortController();
  const onClose = () => { if (!res.writableFinished) controller.abort(); };
  res.on("close", onClose);
  try {
    const actor = pathname.startsWith("/api/") ? budget.actor(req, res) : {};
    await runBudgetContext({ ...actor, signal: controller.signal }, () => handleRequest(req, res));
  } catch { if (!res.headersSent) json(res, 503, { error: "邮局暂不可用，请稍后重试。" }); else res.end(); }
  finally { if (mutation) sessionLocks.delete(mutation); res.off("close", onClose); }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, process.env.HOST || "0.0.0.0", () => console.log(`回声邮局 Echo Post → http://127.0.0.1:${PORT}  | 知乎：${Z.zhihuConfigured() ? "已配置，待请求验证" : "热榜/搜索演示降级；知识可独立查阅"} | LLM：${LLM.llmProvider()}`));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => server.close(() => { budget.close(); process.exit(0); }));
