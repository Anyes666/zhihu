import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../lib/engine.mjs";

const fresh = (id = "leaving") => E.createSession(id, "upgrade-engine");
const assignments = letter => Object.fromEntries(letter.body.map(seg => [seg.id, seg.type]));
function talking(char = "silent") {
  const s = fresh();
  E.applySorting(s, assignments(E.LETTERS.leaving));
  E.summon(s, char);
  return s;
}
const coverageLabels = { full: "回信依据覆盖：充分", partial: "回信依据覆盖：部分", blind: "回信依据覆盖：有限" };

for (const letter of Object.values(E.LETTERS)) {
  for (let unlockedMask = 0; unlockedMask < 4; unlockedMask++) {
    for (let mentionedMask = 0; mentionedMask < 4; mentionedMask++) {
      test(`${letter.id}: 确认集合 ${unlockedMask} × 提及集合 ${mentionedMask}，展示与原结局独立`, () => {
        for (const [family, overrides, talkFirst] of [
          ["act", {}, false], ["pause", {}, true],
          ["drift", { demand: 20 }, false], ["backfire", { safety: 49 }, false]
        ]) {
          const s = fresh(letter.id);
          E.applySorting(s, assignments(letter));
          s.truthsUnlocked = letter.truths.filter((_, i) => unlockedMask & (1 << i)).map(t => t.id);
          s.truthSources = Object.fromEntries(s.truthsUnlocked.map(id => [id, "邮局档案"]));
          E.enterWrite(s);
          E.submitReply(s, "愿你能慢慢梳理这些事情，给彼此一点时间。");
          // Isolate display semantics from lexical scoring; exercise every historical branch.
          s.reply.scores = { demand: 70, accuracy: 65, warmth: 60, safety: 80, community: 55, ...overrides };
          s.reply.meta.talkFirst = talkFirst;
          s.reply.meta.truthMentions = letter.truths.filter((_, i) => mentionedMask & (1 << i)).map(t => t.id);
          const confirmed = s.truthsUnlocked.length;
          const mentioned = s.reply.meta.truthMentions.length;
          const score = (confirmed + mentioned) / 2;
          const level = score >= 1.5 ? "full" : score >= 0.5 ? "partial" : "blind";
          const expected = {
            confirmed: { count: confirmed, total: 2, label: `已确认真相 ${confirmed}/2` },
            coverage: { score, total: 2, level, label: coverageLabels[level],
              confirmedMentioned: s.truthsUnlocked.filter(id => s.reply.meta.truthMentions.includes(id)).length }
          };
          const before = structuredClone(s);
          assert.deepEqual(E.evidenceView(s), expected);
          assert.deepEqual(s, before, "展示函数不得修改会话");
          assert.deepEqual(E.decideEnding(letter, s), { family, depth: level, truthScore: score });
          assert.deepEqual(E.publicState(s).evidence, expected);
          const ending = E.finalize(s);
          assert.deepEqual(ending.evidence, expected);
          assert.deepEqual(ending.card.evidence, expected);
          assert.equal(ending.depthLabel, expected.coverage.label);
          assert.equal(ending.card.depth, ending.depthLabel);
          assert.equal(ending.card.truths, `${confirmed}/2`);
          assert.equal(ending.missed.length, 2 - confirmed);
          assert.equal(ending.depth, level);
          assert.equal(ending.family, family);
          assert.equal(ending.truthScore, score);
          assert.deepEqual(s.resources, before.resources);
          assert.deepEqual(s.reply, before.reply);
          assert.ok(ending.timeline.at(-1).text.endsWith(ending.depthLabel));
          assert.doesNotMatch(ending.depthLabel, /全部|看见|一半/);
          s.endingResult = ending; // Server persists this result; refresh must retain the contract.
          assert.deepEqual(E.publicState(s).endingResult.evidence, E.publicState(s).evidence);
        }
      });
    }
  }
  test(`${letter.id}: mailFacts 按原封存可见规则恢复，错分不能成为事实`, () => {
    const s = fresh(letter.id);
    assert.deepEqual(E.publicState(s).mailFacts, []);
    assert.deepEqual(E.publicState(s).evidence, {
      confirmed: { count: 0, total: 2, label: "已确认真相 0/2" }, coverage: null
    });
    // Intentionally wrong facts plus one correctly classified fact, well below bonus.
    const firstFact = letter.body.find(seg => seg.type === "fact");
    const low = Object.fromEntries(letter.body.map(seg => [seg.id, seg.id === firstFact.id ? "fact" : seg.type === "fact" ? "emotion" : "fact"]));
    const result = E.applySorting(s, low);
    assert.equal(result.bonus, false);
    const expected = letter.body.flatMap((seg, i) => result.items.find(item => item.id === seg.id).type === "fact"
      ? [{ id: seg.id, text: seg.text, source: `来信第${i + 1}句（寄信人陈述，非独立核实）` }] : []);
    assert.equal(expected.length, 1);
    assert.deepEqual(E.publicState(s).mailFacts, expected);
    for (const phase of ["talk", "write", "review", "revise", "echo"]) {
      s.phase = phase;
      assert.deepEqual(E.publicState(structuredClone(s)).mailFacts, expected);
    }
    const bonusSession = fresh(letter.id), high = assignments(letter);
    high[firstFact.id] = "emotion";
    // Even a populated sorting field must remain private until sealing.
    bonusSession.sorting = high; bonusSession.sortBonus = true;
    assert.deepEqual(E.publicState(bonusSession).mailFacts, []);
    bonusSession.sortBonus = false;
    const highResult = E.applySorting(bonusSession, high);
    assert.equal(highResult.bonus, true);
    assert.deepEqual(E.publicState(bonusSession).mailFacts.map(f => f.id), letter.body.filter(seg => seg.type === "fact").map(seg => seg.id));
    assert.equal(bonusSession.resources.stamps, E.RESOURCES.stamps + 1);
  });
}

test("真实玩法复现：只确认一条但 full，不能再宣称已看全", () => {
  const s = talking();
  E.ask(s, "silent", "阿姨，那个租房页面，您最怕的是什么？");
  E.enterWrite(s);
  E.submitReply(s, "南，你已经很不容易了，可以先谈一次租房的事，再给 HR 回复邮件。");
  const before = E.decideEnding(E.LETTERS.leaving, s);
  assert.equal(before.depth, "full");
  const ending = E.finalize(s);
  assert.equal(ending.missed.length, 1);
  assert.equal(ending.depthLabel, coverageLabels.full);
  assert.equal(ending.evidence.confirmed.label, "已确认真相 1/2");
  assert.equal(ending.evidence.coverage.confirmedMentioned, 1);
});

for (const [char, q, attitude] of [
  ["laozhou", "嗯。", "neutral"], ["data", "具体多少次？", "precise"],
  ["silent", "阿姨，那个租房页面，您最怕的是什么？", "gentle"],
  ["silent", "那个租房页面是不是你故意打开的？", "leading"],
  ["silent", "你懂什么！！", "hostile"], ["data", "??????", "hostile"]
]) {
  test(`ask ${char}/${attitude}: 回执来自真实前后状态且公开范围受限`, () => {
    const s = talking(char), before = structuredClone(s);
    const response = E.ask(s, char, q), r = response.receipt;
    assert.ok(r, "成功 ask 应包含 receipt");
    assert.equal(r.type, "ask"); assert.equal(r.char, char);
    assert.deepEqual(r.stamps, { before: before.resources.stamps, after: s.resources.stamps, delta: -1 });
    assert.deepEqual(r.trust, { before: before.trust[char], after: s.trust[char], delta: response.trustDelta });
    assert.deepEqual(r.attitude, { id: attitude, label: E.ATTITUDE_LABEL[attitude] });
    assert.deepEqual(r.mood, { before: before.mood[char], after: s.mood[char] });
    assert.equal(r.left, s.left.includes(char) && !before.left.includes(char));
    assert.deepEqual(r.newTruths, E.publicState(s).truthsUnlocked.filter(t => !before.truthsUnlocked.includes(t.id)));
    assert.deepEqual(E.publicState(s).talks.at(-1).receipt, r);
    assert.ok(r.rules.length > 0 && r.rules.every(rule => typeof rule === "string"));
    assert.ok(r.nextActions.some(a => a.id === "write"));
    assert.equal(r.nextActions.some(a => a.id === "ask"), !r.left);
    assert.deepEqual(s.resources, { ...before.resources, stamps: before.resources.stamps - 1 });
    const json = JSON.stringify(r);
    for (const hidden of E.LETTERS.leaving.truths.filter(t => !s.truthsUnlocked.includes(t.id))) {
      assert.ok(!json.includes(hidden.title), "回执不得公开隐藏标题");
      assert.ok(!json.includes(hidden.text), "回执不得公开隐藏正文");
    }
    assert.ok(!json.includes("triggers") && !json.includes("mentionKeys") && !json.includes("candidate"));
  });
}

test("信任上/下限：差值按 clamp 后状态计算，历史回执不随后续操作漂移", () => {
  for (const [char, trust, q, after] of [["silent", 98, "阿姨，您还好吗？", 100], ["data", 3, "你懂什么！！", 0]]) {
    const s = talking(char); s.trust[char] = trust;
    const first = E.ask(s, char, q);
    assert.ok(first.receipt);
    assert.deepEqual(first.receipt.trust, { before: trust, after, delta: after - trust });
    const saved = structuredClone(first.receipt);
    E.ask(s, char, "嗯。");
    assert.deepEqual(first.receipt, saved);
    assert.deepEqual(s.talks[0].receipt, saved);
  }
});

test("直接重复 ask 保留原扣费规则、不重复解锁，邮票耗尽后失败无新回执", () => {
  const s = talking(), q = "阿姨，那个租房页面，您最怕的是什么？";
  const first = E.ask(s, "silent", q);
  assert.equal(first.receipt?.newTruths.length, 1);
  const second = E.ask(s, "silent", q);
  assert.equal(second.truthRevealed, null);
  assert.deepEqual(second.receipt.newTruths, []);
  assert.equal(second.receipt.stamps.delta, -1);
  assert.equal(s.resources.stamps, 2);
  E.ask(s, "silent", q);
  const last = E.ask(s, "silent", q);
  assert.equal(last.receipt.stamps.after, 0);
  assert.ok(!last.receipt.nextActions.some(a => a.id === "ask"));
  const before = structuredClone(s);
  assert.throws(() => E.ask(s, "silent", q), /邮票已用完/);
  assert.deepEqual(s, before);
});

test("阶段错误、未邀请、已离开、额度耗尽：失败不扣费/不改状态/不伪造回执", () => {
  const wrongPhase = fresh(), unsummoned = talking("data"), departed = talking(), empty = talking();
  E.ask(departed, "silent", "你懂什么！！");
  assert.equal(departed.talks.at(-1).receipt?.left, true);
  empty.resources.stamps = 0;
  for (const [s, error] of [[wrongPhase, /寻声/], [unsummoned, /召唤/], [departed, /离开/], [empty, /邮票/]]) {
    const before = structuredClone(s);
    assert.throws(() => E.ask(s, "silent", "您还好吗？"), error);
    assert.deepEqual(s, before);
  }
});

test("回执动作严格受剩余资源及公开状态限制，邀请与档案不改变 ask 扣费", () => {
  const s = talking("silent");
  const before = structuredClone(s.resources);
  assert.equal(E.summon(s, "silent").already, true);
  assert.deepEqual(s.resources, before);
  E.summon(s, "data");
  E.unlockTruth(s);
  const r = E.ask(s, "data", "offer 的截止日是哪天？HR 催了几次？").receipt;
  assert.ok(r);
  assert.deepEqual(r.newTruths.map(t => t.id), ["t2"]);
  assert.ok(!r.nextActions.some(a => ["summon", "unlock"].includes(a.id)));
  assert.equal(s.resources.summons, 0);
  assert.equal(s.resources.unlock, 0);
  assert.equal(s.resources.stamps, before.stamps - 1);
});
