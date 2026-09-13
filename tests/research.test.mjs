import test from "node:test";
import assert from "node:assert/strict";
import { createSession, publicState, applySorting, LETTERS, submitReply } from "../lib/engine.mjs";
import { rememberSources, reserveQuery, saveNote, removeNote, researchReceipt } from "../lib/research.mjs";
const session = () => { const s = createSession("leaving", "test"); applySorting(s, Object.fromEntries(LETTERS.leaving.body.map(b => [b.id, "fact"]))); return s; };
const result = { capability: "knowledge", source: "live", fetchedAt: "2026-09-13T00:00:00Z", stale: false, items: [1,2,3].map(n => ({ id: String(n), title: "参考资料" + n, text: "只能用作参考的短摘要", url: "https://www.zhihu.com/" })) };
const reflection = "社区经验并不代表南的处境，需要先问清她自己的意愿。";
test("来源归会话所有，拒绝伪造 ID（含原型键）", () => {
  const s = session(); rememberSources(s, result);
  for (const id of ["fake", "__proto__", "constructor", "toString"]) assert.throws(() => saveNote(s, { id, mode: "support", reflection }), /先查阅/);
});
test("笔记最多两条，可更新和删除，live 转 cache 不重复来源", () => {
  const s = session(), cards = rememberSources(s, result);
  assert.equal(rememberSources(s, { ...result, source: "cache" })[0].id, cards[0].id);
  saveNote(s, { id: cards[0].id, mode: "support", reflection }); saveNote(s, { id: cards[1].id, mode: "contrast", reflection });
  assert.throws(() => saveNote(s, { id: cards[2].id, mode: "question", reflection }), /最多/);
  saveNote(s, { id: cards[0].id, mode: "question", reflection }); assert.equal(researchReceipt(s).notes[0].mode, "question");
  removeNote(s, cards[0].id); assert.equal(researchReceipt(s).notes.length, 1);
});
test("反思长度、使用方式与阶段边界", () => {
  const s = session(), [c] = rememberSources(s, result);
  for (const text of ["简短", "长".repeat(161)]) assert.throws(() => saveNote(s, { id: c.id, mode: "support", reflection: text }), /8–160/);
  assert.throws(() => saveNote(s, { id: c.id, mode: "award", reflection }), /请选择/);
  s.phase = "revise"; saveNote(s, { id: c.id, mode: "question", reflection });
  s.phase = "review"; assert.throws(() => saveNote(s, { id: c.id, mode: "question", reflection }), /封存/); assert.throws(() => removeNote(s, c.id), /封存/);
});
test("查阅限三个不同主题，空白/清洗后空内容不占额度", () => {
  const s = session(); assert.throws(() => reserveQuery(s, "<>"), /检索词/);
  for (const query of ["亲子边界", "亲子边界", "异地工作", "面试选择"]) reserveQuery(s, query);
  assert.equal(s.research.queries.length, 3); assert.throws(() => reserveQuery(s, "第四主题"), /三个主题/);
});
test("资料与笔记不修改真相、资源或相同回信的评分", () => {
  const s = session(), without = session(), before = publicState(s), [card] = rememberSources(s, result);
  saveNote(s, { id: card.id, mode: "question", reflection });
  assert.deepEqual(publicState(s), before);
  s.phase = without.phase = "write";
  const reply = "南，你已经很不容易了。先说结论，不妨先和妈妈谈一谈，问清她的担心。今晚可以列出自己的选择，向HR确认机会是否还有效。";
  assert.deepEqual(submitReply(s, reply).scores, submitReply(without, reply).scores);
  assert.equal(researchReceipt(s).liveReferences, 1);
});
