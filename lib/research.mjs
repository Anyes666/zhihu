// Session-owned research notebook. Public references never unlock fictional truths.
import { createHash } from "node:crypto";
import { plainText } from "./zhihu.mjs";
const MODES = new Set(["support", "contrast", "question"]);
export function researchState(session) {
  return session.research ||= { cards: {}, notes: [], queries: [] };
}
export function rememberSources(session, result) {
  const state = researchState(session);
  return result.items.slice(0, 10).map(item => {
    const id = createHash("sha256").update(`${result.capability}:${item.id || item.url}:${item.title}`).digest("hex").slice(0, 20);
    const card = { ...item, id, workId: item.id || null, source: result.source, capability: result.capability, fetchedAt: result.fetchedAt, stale: result.stale };
    if (!state.cards[id] && Object.keys(state.cards).length >= 60) return null;
    state.cards[id] = card;
    return card;
  }).filter(Boolean);
}
export function reserveQuery(session, raw) {
  if (!["talk", "write", "revise"].includes(session.phase)) throw new Error("请在寻声或落笔时查阅资料");
  if (typeof raw !== "string" || raw.trim().length < 2 || raw.trim().length > 80) throw new Error("请输入 2–80 字的检索词，不要提交个人隐私");
  const query = plainText(raw, 80), state = researchState(session);
  if (query.length < 2) throw new Error("请输入有效的 2–80 字检索词");
  if (!state.queries.includes(query)) {
    if (state.queries.length >= 3) throw new Error("本局已查阅三个主题，请先消化已有资料");
    state.queries.push(query);
  }
  return query;
}
export function saveNote(session, { id, mode, reflection } = {}) {
  if (!["talk", "write", "revise"].includes(session.phase)) throw new Error("回信寄出后，来源回执已封存");
  const state = researchState(session), card = state.cards[id];
  if (typeof id !== "string" || !Object.hasOwn(state.cards, id) || !card) throw new Error("请先查阅这张来源卡，不能提交自造来源");
  if (!MODES.has(mode)) throw new Error("请选择参考、对照或待核实");
  if (typeof reflection !== "string" || reflection.trim().length < 8 || reflection.trim().length > 160) throw new Error("请用 8–160 字说明这条资料的启发或适用边界");
  const index = state.notes.findIndex(n => n.id === id);
  if (index < 0 && state.notes.length >= 2) throw new Error("最多保留两条资料，请先移除一条");
  const note = { ...card, mode, reflection: reflection.trim() };
  if (index >= 0) state.notes[index] = note; else state.notes.push(note);
  return state.notes;
}
export function removeNote(session, id) {
  if (!["talk", "write", "revise"].includes(session.phase)) throw new Error("回信寄出后，来源回执已封存");
  const state = researchState(session); state.notes = state.notes.filter(n => n.id !== id); return state.notes;
}
export function researchReceipt(session) {
  const notes = researchState(session).notes.map(n => ({ ...n }));
  return { notes, liveReferences: notes.filter(n => ["live", "cache"].includes(n.source)).length, caution: "社区经验和知识摘要不是本案证据；记录资料不会自动加分或解锁真相。" };
}
