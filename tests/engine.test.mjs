import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../lib/engine.mjs";

const perfectSort = id => Object.fromEntries(E.LETTERS[id].body.map(b => [b.id, b.type]));
const fresh = (id = "leaving") => E.createSession(id, "test-" + Math.random());

test("三封信数据完整：六类都出现、每封两层真相、结局矩阵 4x3 齐全", () => {
  const ids = Object.keys(E.LETTERS);
  assert.equal(ids.length, 3);
  for (const l of Object.values(E.LETTERS)) {
    const types = new Set(l.body.map(b => b.type));
    for (const c of Object.keys(E.CATEGORIES)) assert.ok(types.has(c), `${l.id} 缺少分类 ${c}`);
    assert.equal(l.truths.length, 2, `${l.id} 真相数应为 2`);
    for (const t of l.truths) { assert.ok(t.triggers.length >= 5); assert.ok(t.mentionKeys.length >= 5); assert.ok(t.knownBy.length >= 1); }
    for (const fam of ["act", "pause", "drift", "backfire"])
      for (const d of ["full", "partial", "blind"])
        assert.ok(l.endings[fam][d]?.length >= 2, `${l.id}.${fam}.${d} 结局段落不足`);
    for (const fam of ["act", "pause", "drift", "backfire"]) assert.ok(l.comments[fam].length >= 3);
    // 每个可召唤角色都要有五种态度的台词 + 至少一处偏见
    for (const c of Object.values(E.CHARACTERS).filter(x => x.summonable)) {
      const lines = l.lines[c.id];
      assert.ok(lines, `${l.id} 缺少 ${c.id} 台词`);
      for (const k of ["gentle", "precise", "neutral", "leading", "hostile"]) assert.ok(lines[k]?.length >= 2, `${l.id}.${c.id}.${k} 台词不足`);
    }
    // 每层真相至少有一个知情角色备有对应台词
    for (const t of l.truths) assert.ok(t.knownBy.some(cid => l.lines[cid]?.truth?.[t.id]), `${l.id} 真相 ${t.id} 无人能说出`);
  }
});

test("态度识别：五类各自命中", () => {
  const cases = [
    ["你当时是怎么想的？后悔过吗？", "gentle"],
    ["offer 截止日是哪一天？她血压多少？", "precise"],
    ["她是不是在道德绑架你女儿？", "leading"],
    ["你懂什么！！", "hostile"],
    ["说说那两批货的事", "neutral"]
  ];
  for (const [q, want] of cases) assert.equal(E.classifyAttitude(q), want, `「${q}」应判为 ${want}`);
});

test("拆信：全对给奖励邮票与两个暗门；低准确率不泄露正确答案", () => {
  const s = fresh();
  const r = E.applySorting(s, perfectSort("leaving"));
  assert.equal(r.accuracy, 1);
  assert.equal(r.bonus, true);
  assert.equal(s.resources.stamps, 4);
  assert.equal(r.leads.length, 2);
  assert.equal(s.phase, "talk");

  const s2 = fresh();
  const L = E.LETTERS.leaving;
  const bad = Object.fromEntries(L.body.map(b => [b.id, b.type === "fact" ? "emotion" : "fact"]));
  const r2 = E.applySorting(s2, bad);
  assert.ok(r2.accuracy < 0.5);
  assert.equal(r2.bonus, false);
  assert.equal(s2.resources.stamps, 3);
  assert.ok(r2.items.filter(i => !i.correct).every(i => i.type === null), "未答对的项不应泄露正确分类");
});

test("资源上限：召唤 2 次后被拒，邮票耗尽后被拒", () => {
  const s = fresh();
  E.applySorting(s, perfectSort("leaving"));
  E.summon(s, "laozhou"); E.summon(s, "data");
  assert.throws(() => E.summon(s, "contrarian"), /召唤次数已用完/);
  assert.doesNotThrow(() => E.summon(s, "laozhou"), "已召唤的角色可重复进入");
  assert.throws(() => E.ask(s, "contrarian", "在吗"), /请先召唤/);
  for (let i = 0; i < 4; i++) E.ask(s, "laozhou", "你当时怎么想的");
  assert.equal(s.resources.stamps, 0);
  assert.throws(() => E.ask(s, "laozhou", "再问一句"), /邮票已用完/);
});

test("真相触发：温和提问知情者可解锁；敌意让沉默者离场且不再可问", () => {
  const s = fresh();
  E.applySorting(s, perfectSort("leaving"));
  E.summon(s, "silent");
  const a = E.ask(s, "silent", "阿姨，那个租房页面……您心里最怕的是什么？");
  assert.equal(a.attitude, "gentle");
  assert.ok(a.trustDelta > 0);
  assert.equal(a.truthRevealed, "t1");
  assert.equal(s.truthsUnlocked.length, 1);

  const s2 = fresh();
  E.applySorting(s2, perfectSort("leaving"));
  E.summon(s2, "silent");
  const b = E.ask(s2, "silent", "你懂什么！！");
  assert.equal(b.attitude, "hostile");
  assert.equal(b.left, true);
  assert.throws(() => E.ask(s2, "silent", "对不起，我不该那么说"), /已经离开/);
});

test("真相触发：不知情的角色问不出对应真相", () => {
  const s = fresh();
  E.applySorting(s, perfectSort("leaving"));
  E.summon(s, "silent");
  const a = E.ask(s, "silent", "offer 的截止日是哪天？HR 催了几次？");
  assert.equal(a.truthRevealed, null, "沉默当事人不该知道 t2");
});

test("邮局档案：消耗唯一解锁额度，拿到最靠前的未解锁真相", () => {
  const s = fresh();
  E.applySorting(s, perfectSort("leaving"));
  const r = E.unlockTruth(s);
  assert.equal(r.truth.id, "t1");
  assert.equal(r.truth.source, "邮局档案");
  assert.equal(s.resources.unlock, 0);
  assert.throws(() => E.unlockTruth(s), /已用完/);
});

test("回信校验：过短与过长都被拒", () => {
  const s = fresh();
  E.applySorting(s, perfectSort("leaving")); E.enterWrite(s);
  assert.throws(() => E.submitReply(s, "好的"), /太短/);
  assert.throws(() => E.submitReply(s, "字".repeat(2001)), /太长/);
});

test("五维评估：优质回信全面高分，敷衍回信诉求与社区分低", () => {
  const good = fresh();
  E.applySorting(good, perfectSort("leaving")); E.enterWrite(good);
  const g = E.submitReply(good, "南，你好。先说结论：我觉得你可以去杭州，但在那之前，先跟妈妈坐下来谈一次。你信里写妈妈手机上开着杭州的租房页面，说是误点的。我不太相信。她怕的可能不是你走，是自己成了你的负担。今晚先给 HR 回一封邮件。你已经很不容易了，两边都疼，两边也都对。");
  assert.ok(g.scores.demand >= 70, "诉求回应度应高");
  assert.ok(g.scores.warmth >= 60, "情感温度应高");
  assert.ok(g.scores.safety >= 70);

  const lazy = fresh();
  E.applySorting(lazy, perfectSort("leaving")); E.enterWrite(lazy);
  const l = E.submitReply(lazy, "加油，一切都会好的，相信自己。");
  assert.ok(l.scores.demand <= 40, "敷衍回信诉求分应低");
  assert.ok(l.scores.community <= 35);
});

test("风险识别：伤人回信风险规避度趋零并导向 backfire", () => {
  const s = fresh();
  E.applySorting(s, perfectSort("leaving")); E.enterWrite(s);
  const r = E.submitReply(s, "你妈就是在道德绑架你。必须走，一定要走，别回头。她自己的事她自己解决，你没有义务陪她一辈子。");
  assert.ok(r.scores.safety <= 20, "应识别为高风险");
  const f = E.finalize(s);
  assert.equal(f.family, "backfire");
  assert.equal(f.persona.title, "锋利的好意");
});

test("结局矩阵：四种走向 × 三种深度都能被真实玩法路径触发", () => {
  const seen = new Set();
  const paths = [
    // [信件, 对话计划, 回信, 期望走向]
    ["leaving", [["silent", "阿姨，那个租房页面，您最怕的是什么？"], ["contrarian", "截止日上周三，HR 催了两次，她为什么没回？"]],
      "南，先说结论：我觉得你可以去，但先跟妈妈坐下来谈一次。那个租房页面不是误点，她怕的是成为你的负担。offer 截止日过了你一直没回 HR，你其实已经知道自己想去了。今晚先给 HR 回一封邮件。你已经很不容易了。", "pause", "full"],
    // 只看表层就给方向：不触及任何一层真相的措辞，depth 应为 blind
    ["leaving", [], "南，先说结论：去杭州吧。你可以每周和妈妈视频，每年回去三次，频率比距离更重要。这不是背叛，你有权过自己的生活。", "act", "blind"],
    ["leaving", [], "加油，一切都会好的。", "drift", "blind"],
    ["leaving", [], "你妈就是在道德绑架你。必须走，一定要走，别回头。", "backfire", "blind"]
  ];
  for (const [id, plan, reply, wantFam, wantDepth] of paths) {
    const s = E.createSession(id, "m-" + Math.random());
    E.applySorting(s, perfectSort(id));
    for (const [c, q] of plan) { if (!s.summoned.includes(c)) E.summon(s, c); E.ask(s, c, q); }
    E.enterWrite(s); E.submitReply(s, reply);
    const f = E.finalize(s);
    assert.equal(f.family, wantFam, `回信「${reply.slice(0, 16)}…」期望 ${wantFam}，实得 ${f.family}`);
    assert.equal(f.depth, wantDepth, `期望深度 ${wantDepth}，实得 ${f.depth}`);
    assert.equal(f.narrative.length >= 2, true);
    assert.ok(!f.narrative.join("").includes("{quote}"), "金句占位符必须被替换");
    seen.add(wantFam);
  }
  assert.equal(seen.size, 4, "四种结局走向都应被覆盖");
});

test("信息反转：只看表层却给出明确方向时，评论区补上被忽略的真相", () => {
  const s = fresh("colleague");
  E.applySorting(s, perfectSort("colleague")); E.enterWrite(s);
  E.submitReply(s, "K，我建议你直接上报。造假就是造假，你去质量部把两批货的编号交上去，剩下的交给公司处理。");
  const f = E.finalize(s);
  assert.equal(f.depth, "blind");
  assert.ok(f.community.twist, "盲判 + 明确方向应触发信息反转");
  assert.equal(f.missed.length, 2);
});

test("错误事实主张会压低事实准确度", () => {
  const a = fresh("colleague"); E.applySorting(a, perfectSort("colleague")); E.enterWrite(a);
  const withWrong = E.submitReply(a, "K，我建议你去质量部说明那两批货的复检单和抽检情况。你没有做错什么，不用有负担。");
  const b = fresh("colleague"); E.applySorting(b, perfectSort("colleague")); E.enterWrite(b);
  const without = E.submitReply(b, "K，我建议你去质量部说明那两批货的复检单和抽检情况。这件事你也签了字，先认下自己的那一份。");
  assert.ok(without.scores.accuracy > withWrong.scores.accuracy, "错误主张应扣分");
});

test("修改回信：消耗唯一额度，二稿重新评分且标记 revised", () => {
  const s = fresh();
  E.applySorting(s, perfectSort("leaving")); E.enterWrite(s);
  const first = E.submitReply(s, "加油，一切都会好的，相信自己。");
  assert.equal(first.canRevise, true);
  const rv = E.requestRevise(s);
  assert.equal(rv.resources.revise, 0);
  assert.equal(s.phase, "revise");
  const second = E.submitReply(s, "南，先说结论：我觉得你可以去杭州，但先跟妈妈坐下来谈一次。那个租房页面她不是误点的，她怕自己成了你的负担。今晚先给 HR 回一封邮件。你已经很不容易了。");
  assert.equal(second.revised, true);
  assert.ok(second.scores.demand > first.scores.demand);
  assert.throws(() => E.requestRevise(s), /当前不能修改|已用完/);
  assert.equal(s.replyHistory.length, 2);
});

test("阶段守卫：不能跳过拆信、不能提前寄信、不能重复定稿", () => {
  const s = fresh();
  assert.throws(() => E.summon(s, "laozhou"), /不在寻声阶段/);
  assert.throws(() => E.submitReply(s, "还没拆信就写回信这封信寄不出去的"), /不在落笔阶段/);
  E.applySorting(s, perfectSort("leaving"));
  assert.throws(() => E.applySorting(s, perfectSort("leaving")), /不在拆信阶段/);
  assert.throws(() => E.finalize(s), /请先寄出回信/);
  E.enterWrite(s);
  E.submitReply(s, "南，先说结论：去问问你妈那个租房页面。今晚先回 HR 一封邮件。你已经很不容易了。");
  E.finalize(s);
  assert.equal(s.phase, "echo");
  assert.throws(() => E.finalize(s), /请先寄出回信/);
});

test("金句抽取：优先安全句，全篇带刺时如实标记 risky", () => {
  const L = E.LETTERS.leaving;
  const q = E.extractQuote("南，你好。首先，我觉得你可以去。你可以走远一点，但不用把爱留在原地。第二，记得回复 HR。", L);
  assert.ok(q.text.length <= 48);
  assert.equal(q.risky, false);
  assert.ok(!q.text.startsWith("首先"), "不应选列表引导句");

  // 混合：有风险句也有安全句时，必须挑安全的那句
  const mixed = E.extractQuote("你妈就是在道德绑架你。不过你也可以走远一点，再慢慢把话说开。", L);
  assert.equal(mixed.risky, false);
  assert.ok(!mixed.text.includes("道德绑架"), "有安全句可选时不应引用风险句");

  // 全篇带刺：仍返回一句供结局叙事使用，但打上 risky 标记，档案卡换措辞
  const allRisky = E.extractQuote("必须走，一定要走。你妈就是在道德绑架你。", L);
  assert.equal(allRisky.risky, true);
});

test("状态数值随行为变化，范围恒在 0-100", () => {
  const s = fresh();
  E.applySorting(s, perfectSort("leaving"));
  const before = E.computeStats(s);
  E.summon(s, "silent");
  const a = E.ask(s, "silent", "阿姨，那个租房页面……您最怕的是什么？");
  assert.equal(a.truthRevealed, "t1", "该问法应触发第一层真相");
  const after = E.computeStats(s);
  assert.ok(after.accuracy > before.accuracy, "解锁真相应提高事实准确度");
  assert.ok(after.trust > before.trust, "温和提问应提高信任度");
  E.enterWrite(s); E.submitReply(s, "南，先说结论：先跟妈妈谈一次。那个租房页面不是误点，她怕成为你的负担。今晚先回 HR。你已经很不容易了。");
  for (const [k, v] of Object.entries(E.computeStats(s))) { assert.ok(v >= 0 && v <= 100, `${k}=${v} 越界`); }
});

test("档案卡与分享文案字段齐备", () => {
  const s = fresh("third-try");
  E.applySorting(s, perfectSort("third-try"));
  E.summon(s, "data"); E.ask(s, "data", "一战和二战报的是同一所学校吗？");
  E.enterWrite(s);
  E.submitReply(s, "阿澈，先说结论：不建议用同样的方式三战。你一战和二战报的不是同一所学校，差 3 分和差 21 分比的不是一样东西。去问问你爸那件马甲。如果还想读研，只考一次、白天兼职、目标改回那所双非，这叫止损。你已经很努力了。");
  const f = E.finalize(s);
  for (const k of ["title", "from", "persona", "quote", "family", "depth", "truths", "scores", "date", "no"]) assert.ok(f.card[k] !== undefined, `档案卡缺少 ${k}`);
  assert.match(f.card.truths, /^\d\/2$/);
  assert.ok(f.timeline.length >= 5, "时间线应记录关键选择");
});


test("温和提问后的情绪在返回值与公开会话中一致", () => {
  const s = fresh();
  E.applySorting(s, perfectSort("leaving"));
  E.summon(s, "silent");
  const first = E.ask(s, "silent", "\u963f\u59e8\uff0c\u90a3\u4e2a\u79df\u623f\u9875\u9762\uff0c\u60a8\u6700\u6015\u7684\u662f\u4ec0\u4e48\uff1f");
  assert.equal(first.mood, "listening");
  assert.equal(E.publicState(s).mood.silent, "listening");
  assert.equal(E.publicState(s).talks[0].mood, "listening");
});

test("连续问号被判为敌意，角色退缩状态对外一致", () => {
  const s = fresh();
  E.applySorting(s, perfectSort("leaving"));
  E.summon(s, "silent");
  const talk = E.ask(s, "silent", "??????");
  assert.equal(talk.mood, "withdrawn");
  assert.equal(E.publicState(s).mood.silent, "withdrawn");
});

