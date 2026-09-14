// Counterfactual rehearsal: only the reply changes; the actual session never does.
import { submitReply, finalize } from './engine.mjs';

// Bounded by the reply's 2000-character limit. Code points keep emoji intact.
// LCS reports literal edits only; it does not attribute score changes to sentences.
export function diffReplyText(original, alternate) {
  const a = Array.from(original), b = Array.from(alternate), parts = [];
  const append = (type, text) => {
    if (!text) return;
    if (parts.at(-1)?.type === type) parts.at(-1).text += text;
    else parts.push({ type, text });
  };
  if (original === alternate) { append('unchanged', original); return parts; }
  const rows = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      rows[i][j] = a[i] === b[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { append('unchanged', a[i++]); j++; }
    else if (i < a.length && (j === b.length || rows[i + 1][j] >= rows[i][j + 1])) append('removed', a[i++]);
    else append('added', b[j++]);
  }
  return parts;
}

// Whitelist existing rule records; do not expose hidden truth IDs / full scoring meta.
function ruleSummary(meta = {}) {
  return structuredClone(Object.fromEntries(['demandHits', 'factHits', 'wrong', 'riskyHits', 'absolutes', 'imperatives', 'talkFirst']
    .filter(key => meta[key] !== undefined).map(key => [key, meta[key]])));
}
function outcomeView(ending, reply) {
  return structuredClone({ text: reply.text, family: ending.family, familyLabel: ending.familyLabel,
    depth: ending.depth, depthLabel: ending.depthLabel, scores: reply.scores, evidence: ending.evidence ?? null,
    narrative: ending.narrative, quote: ending.quote, quoteRisky: ending.quoteRisky,
    ruleSummary: ruleSummary(reply.meta) });
}
export function rehearseReply(session, text) {
  if (session.phase !== 'echo') throw new Error('请先完成正式回信，到回响阶段再平行试写');
  if (typeof text !== 'string') throw new Error('请输入文字回信');
  function outcome(replyText) {
    const copy = structuredClone(session);
    copy.phase = 'write';
    submitReply(copy, replyText);
    return outcomeView(finalize(copy), copy.reply);
  }
  const original = session.endingResult ? outcomeView(session.endingResult, session.reply) : outcome(session.reply.text);
  // No saved record means no historical evidence: never backfill the formal archive.
  if (!session.endingResult) original.evidence = null;
  const alternate = outcome(text);
  const delta = Object.fromEntries(Object.keys(original.scores).map(key => [key, alternate.scores[key] - original.scores[key]]));
  return { simulation: true, generated: false, original, alternate, delta,
    textDiff: diffReplyText(original.text, alternate.text), changed: original.family !== alternate.family,
    boundary: '只换回信，沿用当时的线索与对话，已知事实不变。由同一规则引擎试演，不消耗邮票、不覆盖正式档案，也不是对现实人生的预测。' };
}
