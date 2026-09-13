// 回声邮局 · 核心游戏引擎（纯逻辑，无 IO，可单测）
// 职责：会话状态机、拆信评分、提问态度识别、信任度与真相触发、回信五维评估、结局分发
import leaving from "../data/letters/leaving.mjs";
import thirdTry from "../data/letters/third-try.mjs";
import colleague from "../data/letters/colleague.mjs";
import CHARACTERS from "../data/characters.mjs";

export const LETTERS = Object.fromEntries([leaving, thirdTry, colleague].map(l => [l.id, l]));
export { CHARACTERS };

export const CATEGORIES = {
  fact: { label: "事实", hint: "可以被核实的信息" },
  emotion: { label: "情绪", hint: "写信人此刻的感受" },
  demand: { label: "诉求", hint: "对方真正想要的回答" },
  bias: { label: "偏见", hint: "被当成事实的预设" },
  avoidance: { label: "逃避", hint: "轻描淡写、不愿面对的那一句" },
  clue: { label: "关键线索", hint: "指向另一层真相的细节" }
};

export const RESOURCES = { summons: 2, stamps: 3, unlock: 1, revise: 1 };
const SORT_BONUS_THRESHOLD = 0.78;

// ---------- 工具 ----------
const norm = s => String(s || "").toLowerCase().replace(/\s+/g, "");
const has = (text, key) => norm(text).includes(norm(key));
const hits = (text, keys) => keys.filter(k => has(text, k));
// Bounded, occurrence-level language rules; not a general semantic classifier.
function assertedTerm(text, key) {
  const source = String(text || "").toLowerCase().replace(/[^\S\r\n]/g, ""), term = norm(key);
  let at = source.indexOf(term);
  while (at >= 0) {
    const before = source.slice(0, at).split(/[，,。！？!?；;\n]|但是|但|却/).at(-1);
    const after = source.slice(at + term.length).split(/[。！？!?；;\n]/)[0];
    const ironic = /难道|呵呵|真不是|可真|不是一般|没有说.*不是|并非.*不是/.test(before);
    const denying = /(?:不是|并非|不叫|不算)(?:一个|个|什么)?$/.test(before);
    const discouraging = /(?:不要|别|不能|不该|不应该|不建议)(?:因为[^，。]{0,12}就|说(?:他|她|你)?(?:是)?|把[^，。]{0,8}当成|给[^，。]{0,8}贴上|再)?[“「"']?$/.test(before);
    const quotedRejection = /^[”」"'](?:这种说法|这句话)?(?:不对|是错的|不合适|太伤人|我不同意)/.test(after);
    if (ironic || !(denying || discouraging || quotedRejection)) return true;
    at = source.indexOf(term, at + term.length);
  }
  return false;
}
const contextualHits = (text, keys) => keys.filter(k => assertedTerm(text, k));
const INSULTS = ["废物","傻","滚","闭嘴","放屁","你懂什么","少废话","别装","骗人","撒谎","活该","有病","白痴","无聊","烦不烦","搞笑","笑话","说人话","少来","不想听","别哭","矫情","装可怜","自私","没出息","懦弱","可笑"];
const hostileHit = text => contextualHits(text, INSULTS).length > 0;
const count = (text, re) => (String(text).match(re) || []).length;
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));
export const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

// 简单可复现随机（用于评论/票数微扰）
function seedOf(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------- 会话 ----------
export function createSession(letterId, id) {
  const letter = LETTERS[letterId];
  if (!letter) throw new Error(`未知信件：${letterId}`);
  const trust = {};
  for (const c of Object.values(CHARACTERS)) if (c.summonable) trust[c.id] = c.trustBase;
  return {
    id, letterId, phase: "sort", createdAt: Date.now(),
    resources: { ...RESOURCES },
    sorting: null, sortAccuracy: 0, sortBonus: false, leads: [],
    truthsUnlocked: [], truthSources: {},
    trust, mood: Object.fromEntries(Object.values(CHARACTERS).filter(c => c.summonable).map(c => [c.id, "guarded"])), summoned: [], left: [], talks: [],
    reply: null, replyHistory: [],
    timeline: [{ t: 0, type: "open", text: `拆开了「${letter.title}」，寄信人：${letter.from}` }],
    ending: null, endingResult: null
  };
}

// 面向客户端的信件视图：段落打乱、隐藏类型
export function letterView(letter, session) {
  const body = letter.body.map(({ id, text }) => ({ id, text }));
  return { id: letter.id, title: letter.title, from: letter.from, time: letter.time, tags: letter.tags, summary: letter.summary, body, surface: letter.surface, truthCount: letter.truths.length };
}

export function publicState(session) {
  const letter = LETTERS[session.letterId];
  return {
    id: session.id, letterId: session.letterId, phase: session.phase, resources: session.resources,
    sortAccuracy: session.sortAccuracy, sortBonus: session.sortBonus, leads: session.leads,
    truthsUnlocked: session.truthsUnlocked.map(id => truthView(letter, id, session.truthSources[id])),
    trust: session.trust, mood: session.mood, summoned: session.summoned, left: session.left,
    talks: session.talks, reply: session.reply, timeline: session.timeline, ending: session.ending, endingResult: session.endingResult,
    stats: computeStats(session)
  };
}

function truthView(letter, id, source) { const t = letter.truths.find(x => x.id === id); return { id, depth: t.depth, title: t.title, text: t.text, source }; }

// ---------- 阶段一：拆信 ----------
export function applySorting(session, assignments) {
  if (session.phase !== "sort") throw new Error("当前不在拆信阶段");
  const letter = LETTERS[session.letterId];
  if (!assignments || Array.isArray(assignments) || Object.keys(assignments).length !== letter.body.length || letter.body.some(seg => !Object.hasOwn(assignments, seg.id) || typeof assignments[seg.id] !== "string" || !Object.hasOwn(CATEGORIES, assignments[seg.id]))) throw new Error("请先完成全部合法分类");
  const result = letter.body.map(seg => ({ id: seg.id, chosen: assignments?.[seg.id] || null, correct: assignments?.[seg.id] === seg.type, type: seg.type }));
  const correct = result.filter(r => r.correct).length;
  const accuracy = correct / letter.body.length;
  session.sorting = assignments; session.sortAccuracy = accuracy; session.sortBonus = accuracy >= SORT_BONUS_THRESHOLD;
  if (session.sortBonus) session.resources.stamps += 1;
  // 正确识别出线索/逃避 → 获得对应真相的方向提示（信息差的来源）
  session.leads = result.filter(r => r.correct && (r.type === "clue" || r.type === "avoidance")).map(r => {
    const truth = r.type === "clue" ? letter.truths[0] : letter.truths[1];
    const who = truth.knownBy.map(id => CHARACTERS[id].name).join("、");
    return { segId: r.id, type: r.type, truthId: truth.id, hint: `这一句指向一层还没被说出来的真相。知道内情的人：${who}。` };
  });
  session.phase = "talk";
  session.timeline.push({ t: Date.now() - session.createdAt, type: "sort", text: `拆信准确率 ${Math.round(accuracy * 100)}%${session.sortBonus ? "，获得 1 枚追加邮票" : ""}` });
  // 准确率不足时不公开错误项的正确答案（拆得好的人拿到完整地图）
  const reveal = session.sortBonus;
  return {
    accuracy, correct, total: letter.body.length, bonus: session.sortBonus, leads: session.leads, surface: letter.surface,
    items: result.map(r => ({ id: r.id, chosen: r.chosen, correct: r.correct, type: r.correct || reveal ? r.type : null })),
    liukanshan: sortComment(accuracy, session.leads.length, letter)
  };
}

function sortComment(acc, leadCount, letter) {
  if (acc >= 0.9) return `拆得很干净。${leadCount ? "你把那句「关键线索」和那句「逃避」都挑出来了——这两句是这封信的暗门。" : ""}我多给你一枚邮票，别浪费。`;
  if (acc >= SORT_BONUS_THRESHOLD) return `不错，大部分都对。${leadCount ? "尤其是你挑出来的那句线索，记着它，等会儿去问知道内情的人。" : "不过最要紧的那一两句你归得有点偏，等会儿问人的时候留个心。"}追加一枚邮票。`;
  if (acc >= 0.5) return `嗐，有一半对。${leadCount ? "好在你抓到了一句要紧的。" : "写信人最不想让你看见的那句话，你好像也没看见。"}邮票还是三枚，省着点用。`;
  return `这封信你读得有点急。写信人把事实、情绪、借口揉在一起，你得先把它们拆开，才知道该问谁。三枚邮票，想清楚再问。`;
}

// ---------- 阶段二：寻声 ----------
export function classifyAttitude(q) {
  const t = String(q || "").trim();
  if (!t) return "neutral";
  if (hostileHit(t) || /[!！]{2,}$/.test(t) || /[?？]{3,}/.test(t)) return "hostile";
  if (/(是不是|难道不|不就是|肯定是|明明|你也觉得|你承认|对吧|难道|无非|不过是|说白了就是|还不是|不会是|不正是|你不觉得)/.test(t)) return "leading";
  if (/\d/.test(t) || /(多少|几次|几年|几个|哪一|具体|什么时候|时间|数据|比例|概率|频率|多久|几点|哪天|截止|日期|多远|多贵|多少钱|编号|哪所|哪家|哪个学校|报的是|是谁的班|谁签|哪一批|是哪)/.test(t)) return "precise";
  if (/(请|能不能|可以吗|想听|愿意|方便|谢谢|辛苦|抱歉|如果你|你觉得|你怎么看|你当时|你是怎么|想问问|能说说|聊聊|还好吗|难不难|后悔|害怕|怕不怕|感受|心情|你怎么想|想过|担心|舍不得|难受|需要什么|想要什么|想对.*说|希望|最怕|在等什么|等什么|想说什么|想不想|要不要跟我说|愿不愿意)/.test(t)) return "gentle";
  return "neutral";
}

export function summon(session, charId) {
  if (session.phase !== "talk") throw new Error("当前不在寻声阶段");
  const c = CHARACTERS[charId];
  if (!c || !c.summonable) throw new Error("无法召唤该角色");
  if (session.summoned.includes(charId)) return { char: charId, already: true, opener: LETTERS[session.letterId].lines[charId].opener, trust: session.trust[charId] };
  if (session.resources.summons <= 0) throw new Error("召唤次数已用完");
  session.resources.summons -= 1; session.summoned.push(charId);
  const letter = LETTERS[session.letterId];
  session.timeline.push({ t: Date.now() - session.createdAt, type: "summon", text: `召唤了 ${c.name}` });
  return { char: charId, opener: letter.lines[charId].opener, trust: session.trust[charId], name: c.name };
}

// 规则引擎生成的角色回复（LLM 不可用时的保证路径；LLM 可用时作为事实骨架）
export function ask(session, charId, q) {
  if (session.phase !== "talk") throw new Error("当前不在寻声阶段");
  if (!session.summoned.includes(charId)) throw new Error("请先召唤该角色");
  if (session.left.includes(charId)) throw new Error("这个人已经离开了");
  if (session.resources.stamps <= 0) throw new Error("追问邮票已用完");
  const letter = LETTERS[session.letterId], c = CHARACTERS[charId], lines = letter.lines[charId];
  const attitude = classifyAttitude(q);
  const delta = c.attitude[attitude] ?? 0;
  const before = session.trust[charId];
  session.trust[charId] = clamp(before + delta);
  const mood = attitude === "hostile" ? "withdrawn" : session.trust[charId] >= 70 ? "open" : session.trust[charId] >= c.trustBase ? "listening" : "guarded";
  session.mood[charId] = mood;
  session.resources.stamps -= 1;
  const n = session.talks.filter(t => t.char === charId).length;

  let text, truthRevealed = null, left = false;
  const leavesNow = c.leaveOnHostile && attitude === "hostile";
  if (leavesNow) { text = lines.hostile[1]; left = true; session.left.push(charId); }
  else {
    // 真相触发：角色知情 + 问题命中触发词 + 态度不为负 + 信任不低于基线
    const candidate = letter.truths.find(t => t.knownBy.includes(charId) && !session.truthsUnlocked.includes(t.id) && hits(q, t.triggers).length > 0);
    const trustOk = session.trust[charId] >= c.trustBase && !["hostile", "leading"].includes(attitude);
    if (candidate && trustOk) {
      truthRevealed = candidate.id; text = lines.truth[candidate.id];
      session.truthsUnlocked.push(candidate.id); session.truthSources[candidate.id] = c.name;
    } else if (candidate && !trustOk && attitude !== "hostile") {
      // 问到点上了但态度/信任不够：欲言又止，给玩家一个信号
      text = pick(lines[attitude === "leading" ? "leading" : "neutral"], n) + (charId === "silent" ? "……" : " ——你问到点上了，但我现在不想说。");
    } else {
      text = pick(lines[attitude] || lines.neutral, n);
      if (n === 1 && lines.bias && attitude !== "hostile") text += " " + lines.bias; // 第二次回答暴露自身偏见
    }
  }
  const talk = { char: charId, name: c.name, q, a: text, attitude, mood: session.mood[charId], trustDelta: session.trust[charId] - before, trust: session.trust[charId], truthRevealed, left, at: Date.now() - session.createdAt };
  session.talks.push(talk);
  session.timeline.push({ t: talk.at, type: "ask", text: `向 ${c.name} 提问（${ATTITUDE_LABEL[attitude]}）${truthRevealed ? "，解锁真相「" + letter.truths.find(t => t.id === truthRevealed).title + "」" : ""}${left ? "，对方离开了" : ""}` });
  return { ...talk, truth: truthRevealed ? truthView(letter, truthRevealed, c.name) : null, resources: session.resources };
}

export const ATTITUDE_LABEL = { gentle: "温和", precise: "具体", neutral: "中性", leading: "引导", hostile: "敌意" };

export function unlockTruth(session) {
  if (session.phase !== "talk") throw new Error("当前不在寻声阶段");
  if (session.resources.unlock <= 0) throw new Error("真相解锁已用完");
  const letter = LETTERS[session.letterId];
  const t = letter.truths.find(x => !session.truthsUnlocked.includes(x.id));
  if (!t) throw new Error("真相已全部解锁");
  session.resources.unlock -= 1; session.truthsUnlocked.push(t.id); session.truthSources[t.id] = "邮局档案";
  session.timeline.push({ t: Date.now() - session.createdAt, type: "unlock", text: `动用邮局档案，解锁真相「${t.title}」` });
  return { truth: truthView(letter, t.id, "邮局档案"), resources: session.resources };
}

export function enterWrite(session) {
  if (!["talk", "write", "revise", "review"].includes(session.phase)) throw new Error("当前还不能进入落笔阶段");
  if (session.phase === "talk") { session.phase = "write"; session.timeline.push({ t: Date.now() - session.createdAt, type: "write", text: "开始落笔" }); }
  return session.phase;
}

// ---------- 阶段三：落笔 · 五维评估 ----------
const WARMTH = /(辛苦|不容易|我听见|我看到|我看见|我懂|理解你|抱抱|没关系|不用道歉|不是你的错|你已经|谢谢你|愿意|陪你|一起|慢慢来|不着急|也可以|允许|舍不得|心疼|难受|害怕|眼泪|哭|温柔|好好|照顾|辛苦了|很难|不容易|我知道|我明白|被看见|值得|勇敢|没有错|两边都|都对|都疼|相信你|不是罪|不是背叛|不叫认输|不是软弱|不是你一个人|不用一个人|我陪|有人看见|被理解|你可以的|不着急)/g;
const IMPERATIVE = /(必须|应该|你要|赶紧|马上|别再|不要再|立刻|你得|你必须|你应该|不能再)/g;
const ABSOLUTE = /(一定|绝对|肯定|必须|唯一|只能|永远|所有人|没有人|从来|根本|完全|毫无|绝不)/g;
const STRUCTURE = /(先说结论|结论是|结论：|首先|其次|最后|第一|第二|第三|1[.、．]|2[.、．]|一、|二、|三、|一是|二是)/;
const ACTION = /(先|可以试着|不妨|建议|第一步|今晚|明天|这周|这几天|回复|去问|去谈|坐下来|开口|列一张|写下来|打个电话|见一面|给自己|设一个|止损|条件)/;
const TALK_FIRST = /(先跟|先和|先问|先去.{0,6}[问找]|谈一次|谈一谈|谈谈|聊一聊|聊聊|聊一次|问问|问他|问她|问一句|找他|找她|坐下来|开口|说一次|摊开|把.{0,12}说出来|先听)/;
const CITE = /(数据|调研|研究|统计|有位|有人说|过来人|答主|评论区|知乎|据|口径|案例|经验)/;

export function scoreReply(letter, session, text) {
  const t = String(text || "").trim(), L = t.replace(/\s/g, "").length;
  const you = count(t, /你/g);
  const sentences = t.split(/[。！？!?\n]+/).filter(s => s.trim());
  const paragraphs = t.split(/\n{1,}/).filter(s => s.trim());

  // 1 诉求回应度
  let demand = 20;
  const demandHits = hits(t, letter.demandKeys);
  if (demandHits.length) demand += 30;
  if (/(我觉得|我建议|我的看法|我的建议|不妨|可以先|我会|如果我是你|我想说)/.test(t)) demand += 20;
  if (L >= 80) demand += 15;
  if (you >= 2) demand += 15;
  if (L < 30) demand = Math.min(demand, 35);

  // 2 事实准确度
  let accuracy = 30;
  const factHits = hits(t, letter.factKeys);
  accuracy += Math.min(4, factHits.length) * 12;
  const truthMentions = letter.truths.filter(tr => hits(t, tr.mentionKeys).length > 0).map(tr => tr.id);
  for (const id of truthMentions) accuracy += session.truthsUnlocked.includes(id) ? 22 : 12;
  const wrong = hits(t, letter.wrongClaims || []);
  accuracy -= wrong.length * 25;
  if (L < 30) accuracy = Math.min(accuracy, 40);

  // 3 情感温度
  let warmth = 35;
  warmth += Math.min(40, count(t, WARMTH) * 8);
  const imp = count(t, IMPERATIVE);
  if (imp > 1) warmth -= (imp - 1) * 10;
  if (you >= 3) warmth += 10;
  const riskyHits = contextualHits(t, letter.riskyPatterns);
  if (riskyHits.length) warmth -= 15;
  if (contextualHits(t, ["废物","自私","没出息","懦弱","可笑","矫情","活该"]).length) warmth -= 25;
  if (L < 30) warmth = Math.min(warmth, 45);

  // 4 风险规避度（越高越安全）
  let safety = 90;
  safety -= riskyHits.length * 25;
  const abs = count(t, ABSOLUTE);
  if (abs > 2) safety -= (abs - 2) * 6;
  if (contextualHits(t, ["废物","自私","没出息","懦弱","可笑","矫情","活该","去死","不配"]).length) safety -= 30;
  if (wrong.length) safety -= 10;

  // 5 社区适配性
  let community = 30;
  if (STRUCTURE.test(t) || paragraphs.length >= 3) community += 20;
  if (L >= 120 && L <= 800) community += 15; else if (L > 800) community += 5;
  if (CITE.test(t)) community += 10;
  if (ACTION.test(t)) community += 15;
  if (abs > 3) community -= 15;
  if (truthMentions.length) community += 10;
  if (L < 30) community = Math.min(community, 30);

  const scores = { demand: clamp(demand), accuracy: clamp(accuracy), warmth: clamp(warmth), safety: clamp(safety), community: clamp(community) };
  return { scores, meta: { length: L, demandHits, factHits, truthMentions, wrong, riskyHits, absolutes: abs, imperatives: imp, talkFirst: TALK_FIRST.test(t), sentences: sentences.length } };
}

export const DIMENSIONS = {
  demand: { label: "诉求回应度", hint: "有没有回答对方真正问的那件事" },
  accuracy: { label: "事实准确度", hint: "有没有用到信里和对话里拿到的事实" },
  warmth: { label: "情感温度", hint: "对方读完，会觉得被看见还是被审判" },
  safety: { label: "风险规避度", hint: "有没有说出可能伤人或不可逆的话" },
  community: { label: "社区适配性", hint: "放到知乎上，会不会被认可为一个好回答" }
};

export function submitReply(session, text) {
  if (!["write", "revise"].includes(session.phase)) throw new Error("当前不在落笔阶段");
  const letter = LETTERS[session.letterId];
  const t = String(text || "").trim();
  if (t.length < 10) throw new Error("回信太短了，至少写 10 个字");
  if (t.length > 2000) throw new Error("回信太长了，请控制在 2000 字内");
  const { scores, meta } = scoreReply(letter, session, t);
  const isRevision = session.phase === "revise";
  session.reply = { text: t, scores, meta, revised: isRevision };
  session.replyHistory.push({ text: t, scores });
  session.phase = "review";
  session.timeline.push({ t: Date.now() - session.createdAt, type: isRevision ? "revise" : "reply", text: `${isRevision ? "修改后" : ""}寄出回信（${t.length} 字）` });
  return { scores, feedback: replyFeedback(scores, meta, session), canRevise: session.resources.revise > 0 && !isRevision, revised: isRevision };
}

const PRAISE = {
  demand: "你没有绕开她问的那件事，这一点很多人做不到。",
  accuracy: "你把问出来的事实一件件放进了回信里，这封信是有重量的。",
  warmth: "读完这封信，她会先觉得被看见，再去想道理。",
  safety: "你说了真话，也没有一句会在被截图之后伤到她。",
  community: "结构清楚、有依据、有下一步——放到知乎上，这是能被顶上去的回答。"
};
const PUSH = { demand: "把方向收成一句她今晚就能执行的话", accuracy: "再引一处信里的原话", warmth: "在结尾留一句不带建议的话", safety: "把剩下的「一定」「必须」再换掉一个", community: "开头补一句直截了当的结论" };

function replyFeedback(scores, meta, session) {
  const sorted = Object.entries(scores).sort((a, b) => a[1] - b[1]);
  const lowest = sorted[0][0], lowVal = sorted[0][1];
  if (lowVal >= 75) {
    const strongest = sorted[sorted.length - 1][0];
    return { lowest, label: DIMENSIONS[lowest].label, text: PRAISE[strongest] + "五个维度都站得住，最弱的是「" + DIMENSIONS[lowest].label + "」，也只是比其他几项稍软一点。要再往上走，试试" + PUSH[lowest] + "。" };
  }
  const tips = {
    demand: "你写得很用心，但写信人问的那个问题，你好像绕开了。她要的不是一篇感想，是一个可以往下走的方向。",
    accuracy: session.truthsUnlocked.length ? "你已经知道了一些别人不知道的事，可回信里没有用上。真相不说出来，就等于没找到。" : "信里的事实你用得很少。一封回信如果只有态度没有细节，读的人会觉得你没认真看。",
    warmth: "这封回信的道理都对，但读起来像一份判决书。写信人是凌晨哭着写完的，先让她知道你看见了，再讲道理。",
    safety: "有几句话很重，重到可能被截图、被转发、被误解。你可以说得一样诚实，但把「必须」「绝对」这类词换掉。",
    community: "如果这是知乎上的一个回答，它大概会沉下去：没有结论、没有依据、也没有下一步。试试「先说结论，再说为什么，最后给一个可以今晚就做的小事」。"
  };
  return { lowest, label: DIMENSIONS[lowest].label, text: tips[lowest] };
}

export function requestRevise(session) {
  if (session.phase !== "review") throw new Error("当前不能修改");
  if (session.resources.revise <= 0) throw new Error("修改次数已用完");
  session.resources.revise -= 1; session.phase = "revise";
  return { draft: session.reply.text, resources: session.resources };
}

// ---------- 状态数值 ----------
export function computeStats(session) {
  const trustVals = Object.values(session.trust);
  const avgTrust = trustVals.reduce((a, b) => a + b, 0) / trustVals.length;
  const s = session.reply?.scores;
  const letter = LETTERS[session.letterId];
  return {
    trust: clamp(avgTrust),
    accuracy: clamp((session.sortAccuracy * 40) + (session.truthsUnlocked.length / letter.truths.length) * 30 + (s ? s.accuracy * 0.3 : 0)),
    community: s ? s.community : 0,
    warmth: s ? s.warmth : 0,
    risk: s ? 100 - s.safety : 0
  };
}

// ---------- 阶段四：回响 · 结局 ----------
export function decideEnding(letter, session) {
  const { scores, meta } = session.reply;
  const s = scores;
  let family;
  if (s.safety < 50 || (s.warmth < 35 && s.demand > 60)) family = "backfire";
  else if (meta.talkFirst && s.warmth >= 45 && s.safety >= 60) family = "pause";
  else if (s.demand >= 65 && s.safety >= 60) family = "act";
  else if (s.demand >= 45 && s.warmth >= 55 && s.safety >= 60) family = "pause";
  else family = "drift";
  // 真相深度：解锁且提到 =1，解锁未提 / 未解锁猜中 =0.5
  let truthScore = 0;
  for (const t of letter.truths) {
    const unlocked = session.truthsUnlocked.includes(t.id), mentioned = meta.truthMentions.includes(t.id);
    truthScore += unlocked && mentioned ? 1 : (unlocked || mentioned ? 0.5 : 0);
  }
  const depth = truthScore >= 1.5 ? "full" : truthScore >= 0.5 ? "partial" : "blind";
  return { family, depth, truthScore };
}

export const FAMILY_LABEL = { act: "开始行动", pause: "先停下来", drift: "什么都没有立刻改变", backfire: "回信伤到了人" };
export const DEPTH_LABEL = { full: "你看见了信的全部", partial: "你看见了一半", blind: "你只看见了表层" };

export function extractQuote(text, letter) {
  const sentences = String(text).split(/(?<=[。！？!?])|\n/).map(s => s.trim()).filter(Boolean);
  const scored = sentences.map((s, i) => {
    const len = s.replace(/[。！？!?，,]/g, "").length; let sc = 0;
    if (i >= sentences.length * 0.66) sc += 1.5;
    if (count(s, /[，,：:；;]/g) >= 3 || /^(如果|第一|第二|第三|首先|其次|然后|另外|还有)/.test(s)) sc -= 2;
    if (len >= 10 && len <= 42) sc += 3; else if (len < 10) sc -= 3; else sc -= 1;
    if (/你/.test(s)) sc += 2; if (/[？?]$/.test(s)) sc -= 2;
    sc += Math.min(3, count(s, WARMTH));
    if (/^(首先|其次|最后|第一|第二|结论)/.test(s)) sc -= 1;
    // 带风险措辞的句子不做金句：它会被写进结局与分享卡，不能替玩家把伤人的话再放大一次
    const risky = contextualHits(s, letter.riskyPatterns).length > 0 || hostileHit(s) || contextualHits(s, ["去死","不配"]).length > 0;
    return { s, sc, risky };
  }).sort((a, b) => (a.risky - b.risky) || (b.sc - a.sc));
  const best = scored[0] || { s: sentences[0] || "", risky: false };
  let q = String(best.s).replace(/[。！？!?]+$/, "");
  if (q.length > 48) q = q.slice(0, 46) + "…";
  // risky=true 表示整封回信没有一句安全的话可引用：结局叙事仍需要它，但档案卡会换一种措辞
  return { text: q, risky: !!best.risky };
}

export function personaOf(session) {
  const s = session.reply.scores, { family } = session.ending || decideEnding(LETTERS[session.letterId], session);
  const attitudes = session.talks.map(t => t.attitude);
  const most = k => attitudes.filter(a => a === k).length;
  const order = Object.entries(s).sort((a, b) => b[1] - a[1]);
  const top = order[0][0], second = order[1][0];
  const strong = k => s[k] >= 70;
  let title, sub;
  if (family === "backfire") { title = "锋利的好意"; sub = "你想帮，也确实说了真话，只是刀口朝着她。"; }
  else if (family === "drift" && s.demand < 45) { title = "递出纸巾的人"; sub = "你陪了她一会儿，但没有把她往前推一步。"; }
  else if (family === "pause" && strong("accuracy") && strong("warmth")) { title = "先递灯，再指路的人"; sub = "你没有替她决定，只是把她看不见的那几件事照亮了。"; }
  else if (family === "pause") { title = "让她自己开口的人"; sub = "你把话头留给了她，和那个一直没说话的人。"; }
  else if (strong("accuracy") && strong("community")) { title = "清醒的同行者"; sub = "你不替她决定，但把事实一件件放在她面前。"; }
  else if (top === "warmth" || (strong("warmth") && second === "warmth")) { title = "温柔的追问者"; sub = "你先让她知道被看见了，再谈其他。"; }
  else if (top === "community") { title = "先说结论的人"; sub = "你的回信放到知乎上会被点赞：结构清楚、有依据、有下一步。"; }
  else if (top === "safety" && s.demand < 60) { title = "谨慎的守夜人"; sub = "你没有说错任何一句话，也许也少说了一句该说的。"; }
  else { title = "敢下判断的人"; sub = "你给了她一个方向。方向对不对，时间会告诉她。"; }
  const talkStyle = !attitudes.length ? "你一个人也没找，只凭这封信就写了回信。"
    : most("gentle") >= most("precise") && most("gentle") >= most("leading") + most("hostile") ? "对话里你更爱问「你当时怎么想」。"
    : most("precise") > most("gentle") ? "对话里你更信具体的事：日期、数字、谁的班。"
    : most("leading") + most("hostile") > 0 ? `对话里有 ${most("leading") + most("hostile")} 次，你替别人下了结论。` : "对话里你保持了中性。";
  return { title, sub, talkStyle };
}

export function finalize(session, echoes = []) {
  if (session.phase !== "review") throw new Error("请先寄出回信");
  const letter = LETTERS[session.letterId];
  const { family, depth, truthScore } = decideEnding(letter, session);
  session.ending = { family, depth };
  const q = extractQuote(session.reply.text, letter);
  const quote = q.text, quoteRisky = q.risky;
  const narrative = letter.endings[family][depth].map(p => p.replace("{quote}", quote));
  const s = session.reply.scores, seed = seedOf(session.id + session.reply.text);
  // 非线性：知乎上「加油」类回答只有几十赞，结构完整且有依据的回答才上几百
  const pw = (v, k, scale) => Math.pow(Math.max(0, v) / 100, k) * scale;
  const upvotes = Math.round(pw(s.community, 2.5, 500) + pw(s.accuracy, 2, 150) + pw(s.warmth, 2, 60) + (seed % 15));
  const downvotes = Math.round(pw(100 - s.safety, 1.3, 260) + pw(100 - s.accuracy, 2, 60) + (seed % 9));
  const pool = letter.comments[family];
  const comments = [pick(pool, seed), pick(pool, seed + 1), pick(pool, seed + 2)].filter((c, i, a) => a.indexOf(c) === i)
    .map((text, i) => ({ text, votes: Math.max(2, Math.round(upvotes / (3 + i * 2) + ((seed >> i) % 9))), author: pick(["知乎用户", "一个路过的人", "匿名用户", "夜班答主", "看过太多信的人"], seed + i) }));
  if (s.safety < 60) comments.push({ text: "这几句太绝对了，建议答主改一下措辞。", votes: 12 + (seed % 20), author: "知乎用户" });
  if (s.community >= 70) comments.push({ text: "先说结论再给依据，这才是回答应该有的样子。", votes: 30 + (seed % 40), author: "认真答题的人" });
  // 信息反转：没看到真相却给了明确方向 → 评论区有人补上被忽略的事
  const twist = depth === "blind" && (family === "act" || family === "backfire")
    ? { title: "评论区出现了反转", text: `有人在评论里补了一句你没看到的事：${letter.truths[0].text}` } : null;
  const missed = letter.truths.filter(t => !session.truthsUnlocked.includes(t.id)).map(t => ({ title: t.title, text: t.text }));
  session.phase = "echo";
  session.timeline.push({ t: Date.now() - session.createdAt, type: "ending", text: `结局：${FAMILY_LABEL[family]} · ${DEPTH_LABEL[depth]}` });
  const persona = personaOf(session);
  return {
    family, depth, truthScore, familyLabel: FAMILY_LABEL[family], depthLabel: DEPTH_LABEL[depth], narrative, quote, quoteRisky,
    community: { upvotes, downvotes, comments, echoes: echoes.slice(0, 3), twist },
    missed, persona, scores: s, stats: computeStats(session), timeline: session.timeline,
    card: { title: letter.title, from: letter.from, persona: persona.title, quote, quoteRisky, quoteLabel: quoteRisky ? "这封回信里最重的那句话" : "我写下的那句话", family: FAMILY_LABEL[family], depth: DEPTH_LABEL[depth], truths: `${session.truthsUnlocked.length}/${letter.truths.length}`, scores: s, date: new Date().toISOString().slice(0, 10), no: String(1000 + (seed % 9000)) }
  };
}
