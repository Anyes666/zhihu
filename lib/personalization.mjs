// Deterministic, data-minimizing suggestions. Never send personal context to a model.
const text = (v, max = 500) => typeof v === "string" ? v.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
export function parseOfficialJSON(raw) {
  // Node 24 reviver source preserves int64 IDs before Number rounding can corrupt them.
  return JSON.parse(raw, (key, value, context) => typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value) ? context.source : value);
}
export function assertOfficialSuccess(payload) {
  for (const key of ["code", "Code"]) if (payload && Object.hasOwn(payload, key) && ![0, 20000].includes(payload[key])) throw new Error("upstream_failed");
}
export function safeProfile(payload) {
  assertOfficialSuccess(payload);
  const p = payload?.data ?? payload?.Data ?? payload;
  const uid = typeof p?.uid === "string" && /^[1-9]\d{0,19}$/.test(p.uid) ? p.uid : Number.isSafeInteger(p?.uid) && p.uid > 0 ? String(p.uid) : "";
  const id = uid || (typeof p?.hash_id === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(p.hash_id) ? p.hash_id : "");
  if (!id || !p || typeof p !== "object") throw new Error("invalid_profile");
  let avatarUrl = "";
  try { const u = new URL(p.avatar_path); if (u.protocol === "https:" && !u.username && !u.password && !u.port && (u.hostname === "zhimg.com" || u.hostname.endsWith(".zhimg.com"))) avatarUrl = u.href; } catch {}
  return { id, name: text(p.fullname, 60) || "知乎玩家", avatarUrl };
}
const topics = [
  { id: "career", label: "职场与沟通", matches: /职场|同事|工作|团队|沟通|协作|职业/, letterId: "colleague", title: "同事的秘密", question: "当一个人的做法让你不解时，先问问他正在顾虑什么。" },
  { id: "family", label: "家庭与选择", matches: /亲子|家庭|父母|妈妈|母亲|独立|异地|亲情/, letterId: "leaving", title: "离开的人", question: "关心和替别人做决定之间，你会怎样给彼此留出空间？" },
  { id: "study", label: "学习与坚持", matches: /学习|考试|考研|教育|复习|坚持|升学/, letterId: "third-try", title: "三战", question: "在鼓励坚持之前，你想先了解哪些代价和其他选择？" },
];
export function summarizeInterests(items, checks = []) {
  const signals = items.slice(0, 5).map(i => [i?.Title, i?.Summary, i?.Headline, i?.Description].map(v => text(v)).join(" "));
  const selected = topics.map(t => ({ ...t, count: signals.filter(s => t.matches.test(s)).length })).filter(t => t.count > 0).sort((a, b) => b.count - a.count);
  return { source: selected.length ? "authorized-context" : "public", topics: selected.map(t => t.label),
    recommendations: selected.map(t => ({ letterId: t.letterId, title: t.title, question: t.question })), checks,
    explanation: selected.length ? "少量已授权资料中出现了这些主题，只作为选信和提问的参考，不代表对你的性格或经历作出判断。" : "这次资料为空、不可用或没有匹配到游戏主题。你仍可自由选信，不会用演示资料冒充你的兴趣。" };
}
