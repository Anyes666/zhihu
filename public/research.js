import { LETTER_GUIDES, rankKnowledge } from "./experience.js";
// 知乎参考台：资料不是剧情真相，收藏不是得分捷径。
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const modes = { support: "参考", contrast: "对照", question: "待核实" };
export function sourceLabel(card) {
  const origin = { live: "本次 API 获取", cache: "API 缓存", demo: "本地演示 · 非实时", unavailable: "暂不可用" }[card.source] || "来源未确认";
  return origin + (card.stale ? " · 已过期，刷新失败" : "");
}
function sourceLink(card) {
  try {
    const u = new URL(card.url);
    if (u.protocol !== "https:" || !(u.hostname === "zhihu.com" || u.hostname.endsWith(".zhihu.com"))) return "";
    return `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${card.capability === "knowledge" ? "核对官方列表 ↗" : "查阅来源 ↗"}</a>`;
  } catch { return ""; }
}
function noteHTML(note, removable = false) {
  return `<article class="research-note"><div class="research-by"><b>${esc(modes[note.mode])} · ${esc(note.title)}</b>${removable ? `<button class="btn ghost sm" type="button" data-remove="${esc(note.id)}" aria-label="移除${esc(note.title)}">移除</button>` : ""}</div><p>${esc(note.reflection)}</p><div class="research-by"><span>${esc(sourceLabel(note))}</span>${sourceLink(note)}</div></article>`;
}
export function receiptHTML(receipt) {
  if (!receipt) return "";
  return `<section class="panel research-receipt" id="research-receipt"><div class="eyebrow">不是引用越多，回答就越好</div><h3>这封回信的来源回执</h3><p class="muted">${esc(receipt.caution)}</p>${receipt.notes.length ? receipt.notes.map(n => noteHTML(n)).join("") : '<p class="muted">这次没有保留来源笔记。你仍可以凭当事人的话认真作答。</p>'}<p class="muted">${receipt.liveReferences} 条笔记来自实际 API 或其缓存；社区票数和评论均为游戏模拟，未发布到知乎。</p></section>`;
}
export function mountResearch(host, sid, { readOnly = false, letterId } = {}) {
  if (!host) return;
  let data, tab = "knowledge", busy = false;
  host.innerHTML = `<details class="research-desk panel"><summary><span><span class="eyebrow">ZHIHU · 知乎参考台</span><b>别急着替别人做决定，先看看不同的经验。</b></span><span class="tag blue">查阅 → 辨析 → 留下回执</span></summary><p class="research-saved-summary" hidden></p><div class="research-content"></div></details>`;
  const detail = host.querySelector("details"), content = host.querySelector(".research-content");
  const request = async (action, body) => {
    const res = await fetch(`/api/session/${encodeURIComponent(sid)}/${action}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const result = await res.json(); if (!res.ok) throw new Error(result.error || "参考台暂时未响应"); return result;
  };
  const message = text => { const el = host.querySelector(".research-message"); if (el) el.textContent = text; };
  async function load() {
    if (busy) return; busy = true;
    content.innerHTML = '<p role="status">正在查阅知乎资料…首次联网可能需要几秒，不影响继续游戏。</p>';
    try { data = await request("research"); if (host.isConnected) render(); }
    catch (e) { if (host.isConnected) { content.innerHTML = `<p role="alert">${esc(e.message)}</p><button class="btn ghost sm" data-retry>重试</button>`; content.querySelector("[data-retry]").onclick = load; } }
    finally { busy = false; }
  }
  async function change(action, payload, onSuccess) {
    if (busy) return; busy = true;
    host.querySelectorAll("button, input, textarea, select").forEach(el => el.disabled = true);
    message("正在处理…");
    try { const result = await request(action, payload); if (host.isConnected) { onSuccess(result); render(); } }
    catch (e) { if (host.isConnected) { message(e.message); host.querySelectorAll("button, input, textarea, select").forEach(el => el.disabled = readOnly); } }
    finally { busy = false; }
  }
  function render() {
    const channel = data.channels.find(c => c.capability === tab), filtered = data.cards.filter(c => c.capability === tab), cards = tab === "knowledge" ? rankKnowledge(filtered, letterId) : filtered;
    const saved = host.querySelector(".research-saved-summary"); saved.hidden = false; saved.textContent = `已保留 ${data.notes.length}/2 条来源笔记 · 不额外加分`;
    content.innerHTML = `<p class="research-principle">社区里的经历可以启发你，但不能证明这封信的隐情。最多保留两条笔记：写清启发，也写清哪里不能照搬。<strong>不额外消耗邮票，不因收藏加分。</strong></p>
      <div class="research-tabs" role="group" aria-label="资料类型"><button type="button" class="btn sm ${tab === "knowledge" ? "blue" : "ghost"}" data-tab="knowledge" aria-pressed="${tab === "knowledge"}">知乎知识 · 方法参考</button><button type="button" class="btn sm ${tab === "search" ? "blue" : "ghost"}" data-tab="search" aria-pressed="${tab === "search"}">知乎搜索 · 相似经历</button></div>
      <p class="research-channel">${esc(sourceLabel(channel || {}))}${channel?.fetchedAt ? " · 获取于 " + esc(new Date(channel.fetchedAt).toLocaleString("zh-CN")) : ""}${channel?.fallbackReason ? " · " + esc(channel.fallbackReason.startsWith("BUDGET_") ? "实时资料预算保护中，优先使用已有资料" : channel.fallbackReason === "NO_SECRET" ? "未配置知乎 Access Secret" : channel.fallbackReason) : ""}</p>
      ${tab === "search" && !readOnly ? `<form class="research-search"><label>换个角度查阅（剩余 ${data.queriesLeft} 个新主题；不要输入隐私）<input name="query" minlength="2" maxlength="80" required placeholder="如：异地工作与父母的边界"></label><button class="btn sm" type="submit">检索</button></form>` : ""}
      ${tab === "knowledge" ? '<p class="muted">仅为官方知识列表的短摘要，按来信主题关键词排列，不代表结论适用于当事人，也不声称已获取全文。</p>' : ""}
      ${tab === "search" && !readOnly ? `<div class="research-suggestions">${(LETTER_GUIDES[letterId]?.queries || []).map((q,i)=>`<button type="button" class="btn ghost sm" data-query="${i}">${esc(q)}</button>`).join("")}</div><p class="muted">选一个角度只会填入检索词；点击检索才发起查询。</p>` : ""}
      <p class="research-message" role="status" aria-live="polite"></p>
      <div class="research-cards">${cards.length ? cards.map(c => `<article class="research-card" data-source="${esc(c.source)}" data-capability="${esc(c.capability)}"><span class="tag">${esc(sourceLabel(c))}</span><h3>${esc(c.title)}</h3><p>${esc(c.text || c.summary || "暂无摘要，请核对来源。")}</p><div class="research-by"><span>${esc(c.author || "未提供作者")}${typeof c.votes === "number" ? ` · 赞同 ${c.votes}` : ""}</span>${sourceLink(c)}</div>${!readOnly ? `<button type="button" class="btn ghost sm" data-select="${esc(c.id)}">${data.notes.some(n => n.id === c.id) ? "修改这条笔记" : "辨析这条资料"}</button>` : ""}</article>`).join("") : '<p class="muted">本次没有可用资料。可以切换到知识列表，或直接继续游戏；不会扣分。</p>'}</div>
      <div class="research-editor"></div><section class="research-notes"><h3>带进回信的笔记 · ${data.notes.length}/2</h3>${data.notes.map(n => noteHTML(n, !readOnly)).join("") || '<p class="muted">还没有笔记。查阅后，用自己的话留下启发和适用边界。</p>'}</section>`;
    content.querySelectorAll("[data-query]").forEach(button => button.onclick = () => { const input = content.querySelector(".research-search input"); input.value = LETTER_GUIDES[letterId].queries[Number(button.dataset.query)]; input.focus(); });
    content.querySelectorAll("[data-tab]").forEach(button => button.onclick = () => { if (!busy) { tab = button.dataset.tab; render(); } });
    content.querySelector(".research-search")?.addEventListener("submit", event => {
      event.preventDefault(); const query = new FormData(event.target).get("query");
      change("research-search", { query }, result => { data.cards = [...data.cards.filter(c => c.capability !== "search"), ...result.cards]; data.channels = [...data.channels.filter(c => c.capability !== "search"), result]; data.queriesLeft = result.queriesLeft; });
    });
    content.querySelectorAll("[data-remove]").forEach(button => button.onclick = () => change("research-note", { id: button.dataset.remove, remove: true }, r => { data.notes = r.notes; }));
    content.querySelectorAll("[data-select]").forEach(button => button.onclick = () => {
      const id = button.dataset.select, card = data.cards.find(c => c.id === id), saved = data.notes.find(n => n.id === id), editor = content.querySelector(".research-editor");
      editor.innerHTML = `<form class="research-note-form"><h3>如何使用「${esc(card.title)}」？</h3><label>与回信的关系<select name="mode">${Object.entries(modes).map(([key, title]) => `<option value="${key}" ${saved?.mode === key ? "selected" : ""}>${title}</option>`).join("")}</select></label><label>你的启发与适用边界（8–160 字）<textarea name="reflection" minlength="8" maxlength="160" required placeholder="这份资料提醒我……但来信人是否适用，还需要确认……">${esc(saved?.reflection || "")}</textarea></label><button class="btn sm" type="submit">保存来源笔记</button></form>`;
      editor.querySelector("form").onsubmit = event => { event.preventDefault(); const fields = Object.fromEntries(new FormData(event.target)); change("research-note", { id, ...fields }, r => { data.notes = r.notes; }); };
      editor.scrollIntoView({ behavior: "smooth", block: "center" }); editor.querySelector("textarea").focus({ preventScroll: true });
    });
  }
  detail.addEventListener("toggle", () => { if (detail.open && !data) load(); });
}
