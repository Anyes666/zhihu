// Counterfactual rehearsal: only the reply changes; the actual session never does.
import { submitReply, finalize } from './engine.mjs';
export function rehearseReply(session, text) {
  if (session.phase !== 'echo') throw new Error('请先完成正式回信，到回响阶段再平行试写');
  if (typeof text !== 'string') throw new Error('请输入文字回信');
  function outcome(replyText) {
    const copy = structuredClone(session);
    copy.phase = 'write';
    submitReply(copy, replyText);
    const ending = finalize(copy);
    return { family: ending.family, familyLabel: ending.familyLabel, depth: ending.depth, depthLabel: ending.depthLabel, scores: ending.scores, narrative: ending.narrative, quote: ending.quote, quoteRisky: ending.quoteRisky };
  }
  const original = outcome(session.reply.text), alternate = outcome(text);
  const delta = Object.fromEntries(Object.keys(original.scores).map(key => [key, alternate.scores[key] - original.scores[key]]));
  return { simulation: true, generated: false, original, alternate, delta, changed: original.family !== alternate.family,
    boundary: '只换回信，沿用当时的线索与对话。由同一规则引擎试演，不消耗邮票、不覆盖正式档案，也不是对现实人生的预测。' };
}
