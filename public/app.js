import { mountGuide, reflectionMarkup } from "./onboarding.js";
import { LETTER_GUIDES, starterQuestions, stageMarkup } from "./experience.js";
import { mountRehearsal } from "./rehearsal.js";
import { mountResearch, receiptHTML, sourceLabel } from "./research.js";
// 回声邮局 · 前端（原生 ES Module，无构建）
const $ = (s, r = document) => r.querySelector(s);
const app = $("#app"), hud = $("#hud"), statusEl = $("#status");
const S = { meta: null, session: null, letter: null, kanshan: "", chars: {}, view: "home", char: null, sortAssign: {}, selected: null, materials: null, dataPoints: [], ending: null, review: "" };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const CATS = ["fact", "emotion", "demand", "bias", "avoidance", "clue"];
const guide = mountGuide();
function guideSync() {
  guide.sync({ view: S.view, sid: S.session?.id, busy: !!S.busy,
    selected: S.selected, selectedText: S.letter?.body.find(b => b.id === S.selected)?.text, assigned: Object.keys(S.sortAssign).length, total: S.letter?.body.length,
    sortDone: !!$("#go-talk"), summoned: S.session?.summoned.length || 0,
    talks: S.session?.talks.length || 0, stamps: S.session?.resources.stamps || 0,
    researchOpen: !!$(".research-desk")?.open, reviewReady: !!$("#to-echo") && !$("#to-echo").disabled,
    endingReady: !!$("#first-reflection") });
}
function watchResearchGuide() { $(".research-desk")?.addEventListener("toggle", guideSync); }


// ---------- 基础设施 ----------
async function api(path, method = "GET", data) {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
  const j = await res.json().catch(() => ({ error: "服务器响应异常" }));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}
// POST + 解析 SSE 流
async function stream(path, data, handlers) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `HTTP ${res.status}`); }
  const reader = res.body.getReader(), dec = new TextDecoder(); let buf = "";
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx; while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const ev = block.match(/^event: (.*)$/m)?.[1], dat = block.match(/^data: (.*)$/m)?.[1];
      if (!ev) continue; let payload = dat; try { payload = JSON.parse(dat); } catch {}
      if (ev === "error") throw new Error(payload.error || "流式响应出错");
      if (ev === "notice" && payload?.text) {
        const notice = $("#api-budget-notice"); notice.hidden = false; notice.textContent = payload.text;
      }
      handlers[ev]?.(payload);
    }
  }
}
function toast(msg, ms = 2600) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), ms); }
function save() { try { sessionStorage.setItem("echo.state", JSON.stringify({ sid: S.session?.id, view: S.view, char: S.char, sortAssign: S.sortAssign })); } catch {} }
function setHud() {
  const r = S.session?.resources; hud.hidden = !r || ["home", "read"].includes(S.view);
  if (!r) return;
  for (const k of ["summons", "stamps", "unlock", "revise"]) { const el = $("#r-" + k); el.textContent = r[k]; el.parentElement.classList.toggle("empty", r[k] <= 0); }
}
function adopt(r) { S.session = r.session; S.letter = r.letter; S.kanshan = r.liukanshan.opener; S.hints = r.liukanshan.hints; S.norms = r.liukanshan.norms; S.chars = r.chars || {}; }
function view(name) { guide.suspend(); S.view = name; document.body.dataset.stage = name; const journey = $("#journey"); journey.innerHTML = stageMarkup(name); journey.hidden = name === "home"; window.scrollTo({ top: 0, behavior: "smooth" }); setHud(); save(); }
const catLabel = c => S.meta?.categories?.[c]?.label || c;
const charOf = id => S.meta.characters.find(c => c.id === id);
const roleOf = c => c.id === "silent" ? "匿名当事人" : c.role;
const portraitOf = c => c.id === "silent" ? "/assets/char-silent.jpg" : c.portrait;
const charName = id => id === "silent" && S.chars?.silent?.name ? S.chars.silent.name : charOf(id)?.name;

// ---------- 门厅 ----------
async function renderHome() {
  view("home"); S.session = null; S.char = null; S.sortAssign = {}; S.selected = null; S.ending = null; S.materials = null; S.dataPoints = [];
  app.innerHTML = `<div class="panel" style="text-align:center"><span class="spinner"></span> 正在打开邮局的灯…</div>`;
  try { S.meta = await api("/api/letters"); } catch (e) { app.innerHTML = `<div class="panel">邮局暂时打不开：${esc(e.message)}</div>`; return; }
  const h = S.meta.hot;
  const hotBadge = "知乎热榜 · " + sourceLabel(h);
  app.innerHTML = `
  <section class="night-lobby">
    <div class="lobby-copy"><div class="eyebrow">ECHO POST / 今夜由你值班</div><h1>有些回答，<br>会改变一个人的<span>明天。</span></h1>
      <p>拆开一封匿名来信，听见不同立场的人，亲手写下回应。你要找到的不是高赞模板，而是一个陌生人此刻需要的话。</p>
      <div class="lobby-actions"><button class="btn" id="start-shift">接过第一封信 <span>↗</span></button><a class="pick-letter" href="#mail-rack">自己挑一封 ↓</a></div>
      <div class="lobby-facts"><span>无需登录</span><span>主线约 5 分钟</span><span>自由提问与回信</span></div>
    </div>
    <div class="lobby-scene" aria-label="深夜邮局的灯、信纸和待回的来信"><img class="lobby-scene-art" src="/assets/bg-desk.jpg" alt="灯下的书桌上放着未寄出的信"><span class="night-sign">深夜营业 <i></i></span><div class="scene-envelope"><span class="envelope-meta">待回 / 01</span><p>「${esc(S.meta.letters[0].summary)}」</p><span>—— ${esc(S.meta.letters[0].from)}，${esc(S.meta.letters[0].time)}</span><b class="postal-seal" aria-hidden="true">回声<br>邮局</b></div><span class="scene-caption">灯还亮着，就有人在等。</span></div>
  </section>
  <section class="night-promise" aria-label="怎么玩"><div><b>01 / 听见隐情</b><p>把事实与情绪分开，向当事人追问。</p></div><div><b>02 / 借鉴，不照搬</b><p>查阅知乎资料，留下自己的适用边界。</p></div><div><b>03 / 看见后果</b><p>回信之后，再试一次不同的表达。</p></div></section>
  <section class="mail-section" id="mail-rack"><div class="section-heading"><div><div class="eyebrow">TONIGHT'S MAIL</div><h2>今夜，三个人还没睡。</h2></div><span>每封信，都有没说出口的后半句。</span></div>
    <div class="mail-rack">${S.meta.letters.map((l,i)=>`<button class="env file-${i+1}" data-id="${l.id}"><div class="file-top"><span>来信 / 0${i+1}</span><span>${i===0?'初次值班推荐':l.tags.slice(0,2).map(esc).join(' · ')}</span></div><div class="file-story"><div class="from">${esc(l.from)} · ${esc(l.time)}</div><div class="t">${esc(l.title)}</div><p class="sum">${esc(LETTER_GUIDES[l.id].cue)}</p></div><div class="file-bottom"><span>2 层隐情 · 4 种回响</span><b>拆开这封信 ↗</b></div></button>`).join('')}</div>
  </section>
  <section class="night-cast"><div><div class="eyebrow">不是每个人，都知道全部</div><h3>听谁说，怎么问，由你决定。</h3></div><div class="cast-preview">${S.meta.characters.filter(c=>c.summonable).map(c=>`<div><img src="${portraitOf(c)}" alt="${esc(c.name)}的叙事形象" loading="lazy"><span>${esc(c.name)}<small>${esc(roleOf(c))}</small></span></div>`).join('')}</div></section>
  <div class="lobby-details"><details class="panel"><summary>值班须知 · 资源与玩法</summary><p>2 次角色召唤、3 枚追问邮票、1 次档案解锁、1 次回信修改。拆信准确可多获 1 枚邮票。开场白和参考台不消耗邮票；结局后可平行试写，不改正式档案。</p><p>剧情是原创虚构。角色并非全知，社区回响是游戏模拟，资料不能代替当事人的话。</p></details>
  <details class="panel hotlist"><summary>知乎与这间邮局 · ${esc(hotBadge)}</summary><p>热榜关联题材，搜索与知识提供参考，笔记随回信留下来源回执。各项实际来源以卡片标签为准。</p><ol>${h.top.slice(0,6).map((it,i)=>`<li><b>${i+1}</b><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></li>`).join('')}</ol></details></div>`;
  $("#start-shift").onclick = () => startLetter("leaving");
  app.querySelectorAll(".env").forEach(b => b.onclick = () => startLetter(b.dataset.id));
  guideSync();
}

// ---------- 读信 ----------
async function startLetter(letterId) {
  app.innerHTML = `<div class="panel" style="text-align:center"><span class="spinner"></span> 正在拆封…</div>`;
  const r = await api("/api/session", "POST", { letterId });
  adopt(r); S.sortAssign = {}; S.selected = null; renderRead();
}
function renderRead() {
  view("read"); const L = S.letter;
  app.innerHTML = `<section class="read">
    <article class="paper"><div class="meta"><span>回声邮局 · 收件 No.${S.session.id.slice(0, 4).toUpperCase()}</span><span>${esc(L.time)} · ${L.tags.map(esc).join(" · ")}</span></div>
      <h2 style="margin-bottom:16px">${esc(L.title)}</h2>
      ${L.body.map(b => `<p>${esc(b.text)}</p>`).join("")}
      <div class="sign">—— ${esc(L.from)}</div></article>
    <aside class="side">
      <div class="kanshan"><img src="/assets/liukanshan.jpg" alt=""><div class="bubble"><b>刘看山</b>${esc(S.kanshan)}</div></div>
      <div class="panel"><h3>接下来：拆信</h3><p class="muted" style="font-size:13px;margin:8px 0 12px">把这 ${L.body.length} 句话分成六类：<b style="color:var(--text)">事实、情绪、诉求、偏见、逃避、关键线索</b>。分得越准，等会儿能问出的东西越深。这封信里还藏着 ${L.truthCount} 层你现在看不见的真相。</p><button class="btn" id="go-sort">开始拆信 →</button></div>
    </aside></section>`;
  $("#go-sort").onclick = renderSort;
  guideSync();
}

// ---------- 拆信 ----------
function renderSort() {
  view("sort"); const L = S.letter, cats = S.meta.categories;
  app.innerHTML = `<section class="sort">
    <div><div class="eyebrow">① 拆信 · 信息拆解</div><h2 style="margin:6px 0 12px">把每一句话放进它该在的地方</h2>
      <p class="muted" style="font-size:13px;margin:0 0 12px">拖动句子到右侧的分类框，或者先点句子、再点分类。已放入的句子可以点分类框里的小标签撤回。</p>
      <div class="frags" id="frags">${L.body.map((b, i) => `<button class="frag" draggable="true" data-id="${b.id}"><span class="n">${String(i + 1).padStart(2, "0")}</span><span class="tx">${esc(b.text)}</span><span class="cat" hidden></span></button>`).join("")}</div>
    </div>
    <div class="trays" id="trays">${CATS.map(c => `<div class="tray" data-cat="${c}"><h4><button type="button" class="tray-choice" data-choice="${c}">${esc(cats[c].label)}</button><span id="cnt-${c}">0</span></h4><small>${esc(cats[c].hint)}</small><div class="chips" id="chips-${c}"></div></div>`).join("")}</div>
    <div class="sortbar"><div class="progress"><b id="prog" style="width:0%"></b></div><span class="muted" id="prog-t" style="font-size:13px">0 / ${L.body.length}</span><button class="btn" id="seal" disabled>封存分类 →</button></div>
  </section>`;
  const frags = $("#frags"), trays = $("#trays");
  const assign = (id, cat) => { if (S.session.phase !== "sort") return; S.sortAssign[id] = cat; S.selected = null; paintSort(); };
  frags.querySelectorAll(".frag").forEach(f => {
    f.onclick = () => { S.selected = S.selected === f.dataset.id ? null : f.dataset.id; paintSort(); };
    f.ondragstart = e => { e.dataTransfer.setData("text/plain", f.dataset.id); S.selected = f.dataset.id; paintSort(); };
  });
  trays.querySelectorAll(".tray").forEach(t => {
    t.ondragover = e => { e.preventDefault(); t.classList.add("over"); };
    t.ondragleave = () => t.classList.remove("over");
    t.ondrop = e => { e.preventDefault(); t.classList.remove("over"); const id = e.dataTransfer.getData("text/plain"); if (id) assign(id, t.dataset.cat); };
    t.onclick = e => { if (S.session.phase !== "sort") return; if (e.target.closest(".chip")) { delete S.sortAssign[e.target.closest(".chip").dataset.id]; paintSort(); return; } if (S.selected) assign(S.selected, t.dataset.cat); else toast("先点一句话，再点分类框"); };
  });
  $("#seal").onclick = sealSort;
  paintSort();
}
function paintSort() {
  const L = S.letter, n = Object.keys(S.sortAssign).length;
  document.querySelectorAll(".frag").forEach(f => { const c = S.sortAssign[f.dataset.id]; f.classList.toggle("selected", S.selected === f.dataset.id); f.classList.toggle("placed", !!c); const ce = f.querySelector(".cat"); ce.hidden = !c; ce.textContent = c ? catLabel(c) : ""; });
  for (const c of CATS) { const ids = Object.entries(S.sortAssign).filter(([, v]) => v === c).map(([k]) => k); $("#cnt-" + c).textContent = ids.length; $("#chips-" + c).innerHTML = ids.map(id => `<button type="button" class="chip" data-id="${id}" aria-label="撤回：${esc(L.body.find(b => b.id === id).text)}" title="点击撤回">${esc(L.body.find(b => b.id === id).text.slice(0, 12))}…</button>`).join(""); }
  $("#prog").style.width = (n / L.body.length * 100) + "%"; $("#prog-t").textContent = `${n} / ${L.body.length}`; $("#seal").disabled = n < L.body.length;
  save(); guideSync();
}
async function sealSort() {
  const sid = S.session.id;
  try {
    $("#seal").disabled = true; $("#seal").innerHTML = `<span class="spinner"></span>`;
    const r = await api(`/api/session/${S.session.id}/sort`, "POST", { assignments: S.sortAssign });
    S.session = r.session; setHud();
    const res = r.result;
    document.querySelectorAll(".frag").forEach(f => { const it = res.items.find(i => i.id === f.dataset.id); f.classList.add(it.correct ? "ok" : "bad"); f.draggable = false; f.onclick = null; const ce = f.querySelector(".cat"); ce.textContent = it.correct ? `✓ ${catLabel(it.type)}` : it.type ? `✗ 应为「${catLabel(it.type)}」` : `✗ ${catLabel(it.chosen)}`; });
    document.querySelectorAll(".chip").forEach(ch => { const it = res.items.find(i => i.id === ch.dataset.id); ch.classList.add(it.correct ? "ok" : "bad"); });
    $(".trays").insertAdjacentHTML("afterend", `<div class="panel" style="grid-column:1/-1;margin-top:8px">
      <div class="kanshan"><img src="/assets/liukanshan.jpg" alt=""><div class="bubble"><b>刘看山</b>${esc(res.liukanshan)}</div></div>
      <div class="result-grid"><div class="k"><b>${Math.round(res.accuracy * 100)}%</b><span>拆信准确率 · ${res.correct}/${res.total}</span></div><div class="k"><b>${res.bonus ? "+1" : "0"}</b><span>追加邮票${res.bonus ? " · 已到账" : " · 需 78% 以上"}</span></div><div class="k"><b>${res.leads.length}</b><span>抓到的暗门 · 指向隐藏真相</span></div></div>
      ${res.leads.map(ld => `<div class="lead">🔎 <q>${esc(S.letter.body.find(b => b.id === ld.segId).text)}</q><br><span class="muted">${esc(ld.hint)}</span></div>`).join("")}
      <p class="muted" style="font-size:13px;margin:12px 0 0">表层：${esc(res.surface)}</p>
      <div style="margin-top:14px;text-align:right"><button class="btn" id="go-talk">去寻声 · 召唤知道内情的人 →</button></div></div>`);
    $(".sortbar").remove();
    $("#go-talk").onclick = renderTalk;
    $("#go-talk").scrollIntoView({ behavior: "smooth", block: "center" });
    guideSync();
  } catch (e) {
    if (S.session?.id !== sid || S.view !== "sort") return;
    try { const b = await api(`/api/session/${sid}/state`); if (b.session.phase === "talk") { adopt(b); renderTalk(); toast("分类已封存，已恢复寻声。"); return; } } catch {}
    if ($("#seal")) { $("#seal").textContent = "重试封存 →"; $("#seal").disabled = false; }
    toast("封存未确认，分类已保留。请检查网络后重试：" + e.message, 6000); guideSync();
  }
}

// ---------- 寻声 ----------
function renderTalk() {
  view("talk");
  const cast = S.meta.characters.filter(c => c.summonable);
  app.innerHTML = `<section class="talk">
    <aside class="cast" id="cast">
      <div class="eyebrow" style="margin-bottom:2px">② 寻声 · 召唤</div>
      ${cast.map(c => castCard(c)).join("")}
      <div class="panel" style="padding:12px 14px"><div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><img src="/assets/liukanshan.jpg" style="width:28px;height:28px;border-radius:50%" alt=""><h3>刘看山 · 邮差提示</h3></div>
        <div class="kanshan-hints" id="hints"></div><button class="btn ghost sm" id="more-hint" style="margin-top:8px;width:100%">听刘看山说一句（免费）</button></div>
    </aside>
    <div class="panel chat" id="chat"><div class="head" id="chat-head"><div class="muted" style="font-size:14px">← 先从左边召唤一个人。每次召唤消耗 1 次机会，开场白免费；之后每追问一句消耗 1 枚邮票。</div></div>
      <div class="msgs" id="msgs"><div class="chat-invitation"><span>留一个座位，听一句真话。</span><p>先选一位角色。开场白免费；追问会消耗一枚邮票。</p></div></div><div id="question-starters" class="question-starters"></div>
      <div class="compose"><input id="q" placeholder="召唤后在这里提问……（真话通常要问得温和或具体）" disabled maxlength="200"><button class="btn" id="send" disabled>提问</button></div>
      <div class="hintline"><span id="att-hint">提问的态度会被识别：温和 / 具体 / 中性 / 引导 / 敌意 —— 角色会据此改变说多少。</span><span id="stamp-hint"></span></div>
    </div>
    <aside class="board">
      <div class="panel" id="truths"></div>
      <button class="btn blue" id="go-write" style="width:100%">带着线索去落笔 →</button><button class="btn ghost" id="open-research">查阅知乎参考台 ↗</button>
      <div class="panel" id="echoes"><h3>知乎回声 · 社区里的相似经历</h3><div class="muted" style="font-size:12px;margin-top:6px">正在检索…</div></div>
    </aside></section><div id="research-host"></div>`;
  mountResearch($("#research-host"), S.session.id, { letterId: S.letter.id });
  S.hintIdx = 0; paintHints(); paintTruths();
  $("#more-hint").onclick = () => { S.hintIdx++; paintHints(); };
  $("#send").onclick = ask; $("#q").onkeydown = e => { if (e.key === "Enter") ask(); };
  $("#go-write").onclick = () => { if (!S.busy) renderWrite(); };
  $("#open-research").onclick = () => { const desk = $(".research-desk"); desk.open = true; desk.scrollIntoView({ behavior: "smooth", block: "start" }); };
  document.querySelectorAll(".card[data-char]").forEach(c => c.onclick = () => summon(c.dataset.char));
  loadEchoes();
  if (S.char) openChat(S.char, true);
  watchResearchGuide(); guideSync();
}
function castCard(c) {
  const s = S.session, summoned = s.summoned.includes(c.id), left = s.left.includes(c.id);
  return `<button class="card char-${c.id} mood-${s.mood?.[c.id] || "guarded"} ${summoned ? "summoned" : ""} ${left ? "left" : ""} ${S.char === c.id ? "active" : ""}" data-char="${c.id}"><img src="${portraitOf(c)}" alt=""><div><b>${esc(charName(c.id))}</b><div class="role">${esc(roleOf(c))}</div><div class="tl">${esc(left ? "（已离开）" : c.tagline)}</div></div></button>`;
}
function paintHints() {
  const hs = S.hints || []; const box = $("#hints"); if (!box) return;
  box.innerHTML = hs.slice(0, S.hintIdx).map(h => `<div class="h">${esc(h)}</div>`).join("") || `<div class="muted" style="font-size:12px">刘看山知道谁掌握什么，但不会替你问。</div>`;
  const b = $("#more-hint"); if (S.hintIdx >= hs.length) { b.disabled = true; b.textContent = S.norms ? "（他补了一句）" + S.norms : "刘看山说完了"; b.style.whiteSpace = "normal"; b.style.textAlign = "left"; }
}
function paintTruths() {
  const box = $("#truths"); if (!box) return; const s = S.session, total = S.letter.truthCount;
  const unlocked = s.truthsUnlocked;
  box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><h3>线索板 · 真相 ${unlocked.length}/${total}</h3><button class="btn ghost sm" id="unlock" ${s.resources.unlock <= 0 || unlocked.length >= total ? "disabled" : ""}>动用邮局档案</button></div>
    <div style="display:grid;gap:8px;margin-top:10px">
    ${unlocked.map(t => `<div class="truthcard"><b>${esc(t.title)}</b><p>${esc(t.text)}</p><small>来源：${esc(t.source)} · 第 ${t.depth} 层</small></div>`).join("")}
    ${Array.from({ length: total - unlocked.length }).map((_, i) => `<div class="truthcard locked"><b>🔒 第 ${unlocked.length + i + 1} 层真相</b><p class="muted" style="font-size:12px">${s.leads[i] ? esc(s.leads[i].hint) : "问对人、问对态度，或动用一次邮局档案。"}</p></div>`).join("")}
    </div>
    ${s.leads.length ? `<p class="muted" style="font-size:12px;margin:10px 0 0">拆信时你抓到的暗门：${s.leads.map(l => `「${esc(S.letter.body.find(b => b.id === l.segId).text.slice(0, 14))}…」`).join(" ")}</p>` : ""}`;
  $("#unlock").onclick = async () => { try { const r = await api(`/api/session/${S.session.id}/unlock`, "POST"); S.session = r.session; setHud(); paintTruths(); toast(`邮局档案翻开了：「${r.result.truth.title}」`); } catch (e) { toast(e.message); } };
}
async function loadEchoes() {
  const box = $("#echoes"); if (!box) return;
  try {
    const sid = S.session.id;
    const m = await api(`/api/session/${sid}/materials`);
    if (!box.isConnected || S.session?.id !== sid) return;
    S.materials = m;
    const srcLabel = "知乎搜索 · " + sourceLabel(m);
    box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px"><h3>知乎回声 · 相似经历</h3><span class="src ${m.source === "live" ? "live" : ""}">${srcLabel}</span></div><div style="display:grid;gap:8px;margin-top:10px">${m.items.slice(0, 1).map(i => `<div class="echo-item"><b>${esc(i.title)}</b>${esc(i.text.slice(0, 55))}…<div class="by"><span>${esc(i.author)} · 赞同 ${i.votes}</span><a href="${esc(i.url)}" target="_blank" rel="noopener">查看 ↗</a></div></div>`).join("") || '<div class="muted" style="font-size:12px">暂无</div>'}</div>`;
  } catch { box.innerHTML = `<h3>知乎回声</h3><div class="muted" style="font-size:12px">暂时检索不到。</div>`; }
}
async function summon(charId) {
  const s = S.session;
  if (s.left.includes(charId)) return toast("这个人已经离开了。");
  if (!s.summoned.includes(charId) && s.resources.summons <= 0) return toast("召唤次数用完了。你只能和已经召唤过的人继续聊。");
  if (S.busy) return; S.busy = true; lockInput(true); guideSync();
  try {
    const r = await api(`/api/session/${s.id}/summon`, "POST", { charId });
    S.session = r.session; setHud(); S.char = charId;
    document.querySelectorAll(".card[data-char]").forEach(c => c.outerHTML = castCard(charOf(c.dataset.char)));
    document.querySelectorAll(".card[data-char]").forEach(c => c.onclick = () => summon(c.dataset.char));
    openChat(charId, r.result.already, r.result.opener);
  } catch (e) { toast(e.message); lockInput(false); }
  S.busy = false; if ($("#go-write")) $("#go-write").disabled = false;
  guideSync();
}
function lockInput(on) { const q = $("#q"), b = $("#send"); if (!q) return; const disabled = on || S.session.resources.stamps <= 0; q.disabled = disabled; b.disabled = disabled; document.querySelectorAll("[data-starter]").forEach(button => button.disabled = disabled); if ($("#go-write")) $("#go-write").disabled = Boolean(S.busy); if (on) q.value = ""; }
function paintStarters(charId) {
  const box = $("#question-starters"); if (!box) return;
  const questions = starterQuestions(S.letter.id, charId);
  box.innerHTML = `<span>不知道怎么开口？选一句改成自己的话：</span><div>${questions.map((q,i)=>`<button class="btn ghost sm" data-starter="${i}" title="${esc(q.text)}">${q.label} ↗</button>`).join("")}</div><small>只填入，不自动发送 · 确认提问才消耗 1 枚邮票</small>`;
  box.querySelectorAll("[data-starter]").forEach(button => button.onclick = () => { if (S.busy || $("#q").disabled) return; $("#q").value = questions[Number(button.dataset.starter)].text; $("#q").focus(); });
}
function moodLabel(m) { return { guarded: "有所戒备", listening: "认真倾听", open: "逐渐敞开", withdrawn: "不愿多说" }[m] || "有所戒备"; }
function openChat(charId, already, opener) {
  const c = charOf(charId), s = S.session; S.char = charId; save();
  $("#chat-head").dataset.mood = s.mood?.[charId] || "guarded"; $("#chat-head").dataset.char = charId; $("#chat-head").innerHTML = `<img src="${portraitOf(c)}" alt=""><div style="flex:1"><b>${esc(charName(charId))}</b> <span class="muted" style="font-size:12px">${esc(roleOf(c))}</span><div class="muted" style="font-size:12px;margin-top:2px">${esc(c.stance)}</div><div class="mood" id="mood-v">${moodLabel(s.mood?.[charId])}</div></div><div class="trust"><label><span>信任度</span><span id="trust-v">${s.trust[charId]}</span></label><div class="bar"><b id="trust-b" style="width:${s.trust[charId]}%"></b></div></div>`;
  const msgs = $("#msgs"); msgs.innerHTML = "";
  const talks = s.talks.filter(t => t.char === charId);
  if (opener || talks.length === 0) addMsg(charName(charId), opener || "", false);
  if (!opener && talks.length === 0 && already) addMsg(charName(charId), "（他还在。你可以继续问。）", false);
  for (const t of talks) { addMsg("你", t.q, true, t); addMsg(charName(charId), t.a, false, t, !!t.truthRevealed); }
  const left = s.left.includes(charId);
  lockInput(left); $("#q").placeholder = left ? "对方已经离开。" : `向${charName(charId)}提问……`;
  $("#stamp-hint").textContent = `剩余邮票 ${s.resources.stamps} 枚`;
  if (!left) $("#q").focus();
  paintStarters(charId); document.querySelectorAll("[data-starter]").forEach(button => button.disabled = left || s.resources.stamps <= 0);
}
function setReplyOrigin(element, generated) {
  if (!element?.parentElement || typeof generated !== "boolean") return;
  const parent = element.parentElement; parent.querySelector(".reply-origin")?.remove();
  const label = document.createElement("small"); label.className = "reply-origin"; label.dataset.origin = generated ? "model" : "rules";
  label.textContent = generated ? "模型表达 · 情节由规则控制" : "规则文本 · 本段非模型生成"; parent.appendChild(label);
}
function addMsg(who, text, me, talk, truth) {
  const d = document.createElement("div"); d.className = "msg" + (me ? " me" : "");
  d.innerHTML = `<div class="who">${esc(who)}${talk && me ? ` <span class="att">· 态度：${esc({ gentle: "温和", precise: "具体", neutral: "中性", leading: "引导", hostile: "敌意" }[talk.attitude] || talk.attitude)} <span class="d ${talk.trustDelta < 0 ? "neg" : ""}">信任 ${talk.trustDelta >= 0 ? "+" : ""}${talk.trustDelta}</span></span>` : ""}</div><div class="txt ${truth ? "truth" : ""}">${esc(text)}</div>`;
  $("#msgs").appendChild(d); if (!me && talk) setReplyOrigin(d.querySelector(".txt"), talk.generated); $("#msgs").scrollTop = 1e9; return d.querySelector(".txt");
}
async function ask() {
  if (S.busy) return;
  const q = $("#q").value.trim(); if (!q || !S.char) return;
  const s = S.session; if (s.resources.stamps <= 0) return toast("邮票用完了。去落笔吧——或者先听听刘看山。");
  S.busy = true; guideSync(); const askedChar = S.char;
  $("#q").value = ""; lockInput(true);
  const meEl = addMsg("你", q, true); const txt = addMsg(charName(askedChar), "", false); txt.classList.add("cursor"); let acc = "";
  try {
    await stream(`/api/session/${s.id}/ask`, { charId: askedChar, question: q }, {
      meta: m => { meEl.parentElement.querySelector(".who").innerHTML = `你 <span class="att">· 态度：${esc(m.attitudeLabel)} <span class="d ${m.trustDelta < 0 ? "neg" : ""}">信任 ${m.trustDelta >= 0 ? "+" : ""}${m.trustDelta}</span></span>`; $("#trust-v").textContent = m.trust; $("#trust-b").style.width = m.trust + "%"; const moodEl = $("#mood-v"); if (moodEl) moodEl.textContent = moodLabel(m.mood); $("#chat-head").dataset.mood = m.mood || "guarded"; if (m.left) toast(`${m.name}离开了。`); },
      delta: d => { acc += d; txt.textContent = acc; $("#msgs").scrollTop = 1e9; },
      reset: () => { acc = ""; txt.textContent = ""; },
      notice: n => toast(n.text),
      done: d => { txt.classList.remove("cursor"); txt.textContent = d.text; setReplyOrigin(txt, d.generated); S.session = d.session; if (d.truth) { txt.classList.add("truth"); toast(`✦ 解锁真相：「${d.truth.title}」`, 3500); } }
    });
  } catch (e) { txt.classList.remove("cursor"); txt.textContent = "（信号断了）" + e.message; }
  S.busy = false; setHud(); paintTruths();
  const left = S.session.left.includes(askedChar);
  document.querySelectorAll(".card[data-char]").forEach(c => c.outerHTML = castCard(charOf(c.dataset.char)));
  document.querySelectorAll(".card[data-char]").forEach(c => c.onclick = () => summon(c.dataset.char));
  lockInput(left); $("#stamp-hint").textContent = `剩余邮票 ${S.session.resources.stamps} 枚`;
  if (S.session.resources.stamps <= 0) $("#att-hint").textContent = "邮票用完了。你现在知道的，就是你能写进回信里的全部。";
  if (!left) $("#q").focus();
  guideSync();
}

// ---------- 落笔 ----------
async function renderWrite(draft = "") {
  if (typeof draft !== "string") draft = "";
  view("write");
  app.innerHTML = `<div class="panel" style="text-align:center"><span class="spinner"></span> 正在铺开信纸…</div>`;
  const sid = S.session.id; let r;
  try { r = await api(`/api/session/${sid}/write`, "POST"); }
  catch (e) {
    if (S.session?.id !== sid || S.view !== "write") return;
    app.innerHTML = `<section class="panel" role="alert"><h2>信纸暂时没能铺开</h2><p>对话与线索仍然保留。请检查网络后重试。</p><p class="muted">${esc(e.message)}</p><button class="btn" id="go-write">重试进入落笔 →</button></section>`;
    $("#go-write").onclick = () => renderWrite(draft); return;
  }
  if (S.session?.id !== sid || S.view !== "write") return;
  S.session = r.session; S.materials = r.materials; S.dataPoints = r.dataPoints; setHud();
  const s = S.session, L = S.letter, mats = S.materials;
  if (!draft && s.phase === "write") try { draft = sessionStorage.getItem("echo.draft." + s.id) || ""; } catch {}
  const srcLabel = "知乎搜索 · " + sourceLabel(mats);
  app.innerHTML = `<section class="write">
    <aside class="side">
      <div class="eyebrow">③ 落笔 · 自由回信</div>
      <details class="acc" open><summary>原信 · ${esc(L.title)}</summary><div class="in">${L.body.map(b => `<p>${esc(b.text)}</p>`).join("")}</div></details>
      <details class="acc" ${s.truthsUnlocked.length ? "open" : ""}><summary>你拿到的真相 · ${s.truthsUnlocked.length}/${L.truthCount}</summary><div class="in">${s.truthsUnlocked.map(t => `<div class="truthcard" style="margin-top:8px"><b>${esc(t.title)}</b><p>${esc(t.text)}</p></div>`).join("") || `<p class="muted">一层都没有。你只能凭信的表层来写。</p>`}</div></details>
      <details class="acc"><summary>对话记录 · ${s.talks.length} 条</summary><div class="in">${s.talks.map(t => `<p><b style="font-family:var(--sans);font-size:12px;color:var(--muted)">你 → ${esc(t.name)}：</b>${esc(t.q)}<br><b style="font-family:var(--sans);font-size:12px;color:var(--amber)">${esc(t.name)}：</b>${esc(t.a)}</p>`).join("") || `<p class="muted">你没有召唤任何人。</p>`}</div></details>
      <details class="acc"><summary>知乎回声 · <span class="src ${mats.source === "live" ? "live" : ""}" style="font-size:11px">${srcLabel}</span></summary><div class="in" style="display:grid;gap:8px;padding-top:8px">${mats.items.map(m => `<div class="echo-item"><span class="src">${esc(sourceLabel(m.source ? m : S.materials || {}))}</span><b>${esc(m.title)}</b>${esc(m.text)}<div class="by"><span>${esc(m.author)} · 赞同 ${m.votes}</span><a href="${esc(m.url)}" target="_blank" rel="noopener">查看 ↗</a></div></div>`).join("") || "暂无"}</div></details>
      <details class="acc"><summary>林数的数据口径 · ${S.dataPoints.length} 条</summary><div class="in">${S.dataPoints.map(d => `<p style="font-family:var(--sans);font-size:12.5px">· ${esc(d)}</p>`).join("")}</div></details>
    </aside>
    <div>
      <article class="paper"><div class="meta"><span>回信 · 致 ${esc(L.from)}</span><span>${s.reply?.revised || s.phase === "revise" ? "第二稿" : "第一稿"} · 自由书写</span></div>
        <textarea id="reply" maxlength="2000" aria-label="给寄信人的回信" placeholder="写给${esc(L.from)}的话。没有选项，没有模板。&#10;&#10;一些过来人的经验：先说结论，再说依据；用上你问出来的事实；让对方先觉得被看见，再讲道理；最后留一个今晚就能做的小事。">${esc(draft || "")}</textarea>
        <div class="writebar"><span id="cnt">0 字 · 建议 120–600 字</span><button class="btn" id="post">寄出回信 →</button></div>
      </article>
      <div id="research-host"></div><div id="review-area"></div>
    </div></section>`;
  mountResearch($("#research-host"), S.session.id, { letterId: S.letter.id, readOnly: !["talk", "write", "revise"].includes(S.session.phase) });
  const ta = $("#reply");
  const cnt = () => { let saved = ""; try { sessionStorage.setItem("echo.draft." + s.id, ta.value); saved = ta.value ? " · 本标签页已暂存" : ""; } catch { saved = " · 草稿无法暂存，请勿刷新"; } $("#cnt").textContent = `${ta.value.replace(/\s/g, "").length} 字 · 建议 120–600 字${saved}`; };
  ta.oninput = cnt; cnt(); ta.focus();
  $("#post").onclick = postReply;
  if (s.phase === "review" && s.reply) {
    ta.readOnly = true; $("#post").disabled = true;
    $("#review-area").innerHTML = reviewHtml(s.reply.scores, r.dimensions, s.resources.revise > 0 && !s.reply.revised);
    $("#review-txt").textContent = "已恢复这封回信的五维评估。上次的流式点评未保存；分数与修改机会保持不变，可继续改稿或看回响。";
    $("#review-txt").classList.remove("cursor"); bindReview(); fillBars();
  }
  watchResearchGuide(); guideSync();
}
async function postReply() {
  const text = $("#reply").value.trim(); if (text.length < 10) return toast("至少写 10 个字。她凌晨三点还在等。");
  $("#post").disabled = true; $("#reply").readOnly = true;
  const area = $("#review-area"); area.innerHTML = `<div class="panel review"><div class="kanshan"><img src="/assets/liukanshan.jpg" alt=""><div class="bubble"><b>刘看山</b><span class="spinner"></span> 正在读你的回信…</div></div></div>`;
  let scores, canRevise = false, dims, acc = "";
  try {
    await stream(`/api/session/${S.session.id}/reply`, { text }, {
      scores: d => { scores = d.scores; canRevise = d.canRevise; dims = d.dimensions; S.session = d.session; setHud(); area.innerHTML = reviewHtml(scores, dims, canRevise); bindReview(true); fillBars(); guideSync(); },
      delta: d => { acc += d; const b = $("#review-txt"); if (b) b.textContent = acc; },
      reset: () => { acc = ""; },
      done: d => { S.review = d.review || acc; const b = $("#review-txt"); if (b) { b.textContent = S.review; b.classList.remove("cursor"); setReplyOrigin(b, d.generated); } }
    });
  } catch (e) { area.innerHTML = `<div class="panel">${esc(e.message)}</div>`; $("#post").disabled = false; $("#reply").readOnly = false; return; }
  area.scrollIntoView({ behavior: "instant", block: "start" });
  bindReview(); guideSync();
}
// 用 setTimeout 而非 requestAnimationFrame：页面在后台标签页时 rAF 不触发，条形会永远停在 0
function fillBars() { setTimeout(() => document.querySelectorAll(".dim .bar b").forEach(b => b.style.width = b.dataset.v + "%"), 40); }
// Bind immediately, but clearly disable mutations until the full review stream has finished.
// This matches the server's per-session mutation lock and avoids overlapping billed requests.
function bindReview(busy = false) {
  const rv = $("#revise");
  if (rv) {
    rv.disabled = busy;
    rv.onclick = async () => {
      rv.disabled = true;
      try { const r = await api(`/api/session/${S.session.id}/revise`, "POST"); S.session = r.session; renderWrite(r.result.draft); }
      catch (e) { rv.disabled = false; toast(e.message); }
    };
  }
  const go = $("#to-echo");
  if (go) { go.disabled = busy; go.textContent = busy ? "点评中，请稍候…" : "封印寄出 · 看回响 →"; go.onclick = () => { go.disabled = true; renderEcho(); }; }
}
function reviewHtml(scores, dims, canRevise) {
  const keys = ["demand", "accuracy", "warmth", "safety", "community"];
  return `<div class="panel review"><div class="eyebrow">回信评估 · 五个维度</div>
    <div class="dims" style="margin-top:12px">${radar(keys.map(k => scores[k]), keys.map(k => dims[k].label))}
      <div class="dimlist">${keys.map(k => `<div class="dim"><div>${esc(dims[k].label)}<small>${esc(dims[k].hint)}</small></div><div class="bar"><b data-v="${scores[k]}" style="width:0"></b></div><div class="v">${scores[k]}</div></div>`).join("")}</div></div>
    <div class="kanshan" style="margin-top:16px"><img src="/assets/liukanshan.jpg" alt=""><div class="bubble"><b>刘看山</b><span id="review-txt" class="cursor"></span></div></div>
    <div class="actions" style="justify-content:flex-end">${canRevise ? `<button class="btn ghost" id="revise">修改一次（消耗唯一的修改机会）</button>` : ""}<button class="btn blue" id="to-echo">封印寄出 · 看回响 →</button></div></div>`;
}
function radar(vals, labels) {
  const cx = 150, cy = 150, R = 105, n = vals.length, pt = (i, r) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const ring = r => Array.from({ length: n }, (_, i) => pt(i, r).join(",")).join(" ");
  const poly = vals.map((v, i) => pt(i, R * v / 100).join(",")).join(" ");
  return `<svg class="radar" viewBox="0 0 300 300">${[.33, .66, 1].map(k => `<polygon points="${ring(R * k)}" fill="none" stroke="rgba(255,255,255,.12)"/>`).join("")}
    ${Array.from({ length: n }, (_, i) => `<line x1="${cx}" y1="${cy}" x2="${pt(i, R)[0]}" y2="${pt(i, R)[1]}" stroke="rgba(255,255,255,.1)"/>`).join("")}
    <polygon points="${poly}" fill="rgba(0,132,255,.28)" stroke="#3d9dff" stroke-width="2"/>
    ${vals.map((v, i) => { const [x, y] = pt(i, R * v / 100); return `<circle cx="${x}" cy="${y}" r="3.5" fill="#f2b866"/>`; }).join("")}
    ${labels.map((l, i) => { const [x, y] = pt(i, R + 22); return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#cfc7ba">${esc(l)}</text>`; }).join("")}</svg>`;
}

// ---------- 回响 ----------
async function renderEcho(restored = null) {
  view("echo");
  app.innerHTML = `<section class="echo"><div class="narr"><div class="eyebrow">④ 回响 · 回信寄出之后</div><div class="timeskip">· · · 一个月后 · · ·</div><article class="paper" id="narr"><p class="cursor" id="narr-p"></p></article><div id="reflection-host"></div><div id="rehearsal-host"></div><div id="community" style="margin-top:18px"></div></div><aside class="side" id="echo-side"></aside></section>`;
  let ending, acc = "";
  const p = $("#narr-p");
  if (restored) {
    ending = restored; S.ending = restored; renderEchoSide(restored);
    p.textContent = restored.finalText || restored.narrative.join("\n\n"); p.style.whiteSpace = "pre-line"; p.classList.remove("cursor");
    setReplyOrigin(p, restored.generated === true);
    if (restored.generationPending) toast("旁白仍在生成，先恢复完整规则结局；稍后刷新可查看已完成版本。", 5000);
  } else try {
    await stream(`/api/session/${S.session.id}/finalize`, {}, {
      ending: e => { ending = e; S.ending = e; renderEchoSide(e); },
      delta: d => { acc += d; p.innerHTML = esc(acc).replace(/\n\n/g, "</p><p>"); },
      reset: () => { acc = ""; p.textContent = ""; },
      done: d => { document.querySelectorAll("#narr .cursor").forEach(x => x.classList.remove("cursor")); setReplyOrigin($("#narr p"), d.generated); }
    });
  } catch (e) { p.textContent = e.message; return; }
  try { sessionStorage.removeItem("echo.draft." + S.session.id); } catch {}
  renderCommunity(ending);
  $("#reflection-host").innerHTML = reflectionMarkup(S.session, ending);
  mountRehearsal($("#rehearsal-host"), S.session.id, S.session.reply?.text || "");
  guideSync();
}
function renderCommunity(e) {
  const c = e.community, box = $("#community");
  box.innerHTML = `<div class="panel"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><h3>如果这封回信发在知乎</h3><span class="tag blue">社区模拟 · 由五维评分驱动</span></div>
    <div class="votes"><span class="vote">▲ 赞同 <b id="up">0</b></span><span class="vote down">▼ 反对 <b id="down">0</b></span><span class="muted" style="font-size:12px">${c.comments.length} 条评论</span></div>
    ${c.comments.map(cm => `<div class="comment"><div class="av">${esc(cm.author[0])}</div><div><div class="by"><span>${esc(cm.author)}</span><span>▲ ${cm.votes}</span></div><div class="tx">${esc(cm.text)}</div></div></div>`).join("")}
    ${c.twist ? `<div class="twist" style="margin-top:14px"><b>⚠ ${esc(c.twist.title)}</b><p>${esc(c.twist.text)}</p></div>` : ""}
    ${c.echoes?.length ? `<div style="margin-top:16px"><h3 style="font-size:13px;color:var(--muted)">同一话题的参考资料 · 演示与 API 来源分别标注</h3><div style="display:grid;gap:8px;margin-top:8px">${c.echoes.map(m => `<div class="echo-item"><span class="src">${esc(sourceLabel(m.source ? m : S.materials || {}))}</span><b>${esc(m.title)}</b>${esc(m.text)}<div class="by"><span>${esc(m.author)} · 赞同 ${m.votes}</span><a href="${esc(m.url)}" target="_blank" rel="noopener">查看 ↗</a></div></div>`).join("")}</div></div>` : ""}
  </div>`;
  const tween = (id, to) => { const el = $("#" + id); el.textContent = to; let i = 0; const n = 26, timer = setInterval(() => { i++; el.textContent = Math.round(to * (1 - Math.pow(1 - i / n, 3))); if (i >= n) { clearInterval(timer); el.textContent = to; } }, 40); };
  tween("up", c.upvotes); tween("down", c.downvotes);
}
function renderEchoSide(e) {
  const side = $("#echo-side"), keys = ["demand", "accuracy", "warmth", "safety", "community"], lab = { demand: "诉求回应", accuracy: "事实准确", warmth: "情感温度", safety: "风险规避", community: "社区适配" };
  side.innerHTML = `${receiptHTML(e.research)}<div class="panel persona"><div class="eyebrow">你的回答人格</div><div class="t">${esc(e.persona.title)}</div><p>${esc(e.persona.sub)}</p><p class="muted">${esc(e.persona.talkStyle)}</p><div style="margin-top:10px"><span class="tag amber">${esc(e.familyLabel)}</span> <span class="tag">${esc(e.depthLabel)}</span></div></div>
    ${e.missed.length ? `<div class="missed"><b>你没看到的 ${e.missed.length} 层真相</b>${e.missed.map(m => `<p><b style="color:var(--amber);font-size:13px">${esc(m.title)}</b>　${esc(m.text)}</p>`).join("")}</div>` : `<div class="missed"><b>你看见了这封信的全部真相</b><p>两层都被你问出来了。</p></div>`}
    <div class="panel"><h3>关键选择时间线</h3><div class="timeline" style="margin-top:10px">${e.timeline.map(t => `<div><i></i><span>${esc(t.text)}</span></div>`).join("")}</div></div>
    <div class="panel cardwrap"><h3 style="margin-bottom:10px">回声档案卡</h3><canvas id="card" width="900" height="1350"></canvas><div class="actions"><button class="btn sm" id="dl">下载图片</button><button class="btn ghost sm" id="copy">复制文案</button><button class="btn ghost sm" id="again">再接一封信</button></div></div>`;
  drawCard(e, keys, lab);
  $("#dl").onclick = () => { const a = document.createElement("a"); a.download = `回声邮局-${e.card.title}-${e.card.no}.png`; a.href = $("#card").toDataURL("image/png"); a.click(); };
  $("#copy").onclick = async () => { const txt = `【回声邮局 · 档案 No.${e.card.no}】\n我拆开了《${e.card.title}》——${e.card.from}的信。\n结局：${e.familyLabel} · ${e.depthLabel}\n回答人格：${e.persona.title}\n${e.card.quoteLabel}：「${e.quote}」\n五维：${keys.map(k => lab[k] + e.scores[k]).join(" / ")}\n#回声邮局 #知乎黑客松`; try { await navigator.clipboard.writeText(txt); toast("文案已复制"); } catch { toast("复制失败，请手动截图"); } };
  $("#again").onclick = () => { sessionStorage.removeItem("echo.state"); renderHome(); };
}
function drawCard(e, keys, lab) {
  const cv = $("#card"), ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
  const img = new Image(); img.src = "/assets/card-paper.jpg";
  const draw = () => {
    ctx.clearRect(0, 0, W, H); if (img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, W, H); else { ctx.fillStyle = "#e9d8b4"; ctx.fillRect(0, 0, W, H); }
    const ink = "#2a2420", muted = "#6b5b48", amber = "#9a5b12", blue = "#0b5fb8";
    const serif = `"Songti SC","Noto Serif CJK SC","SimSun",serif`, sans = `"PingFang SC","Microsoft YaHei",sans-serif`;
    const wrap = (text, x, y, maxW, lh, font, color, maxLines = 6) => { ctx.font = font; ctx.fillStyle = color; let line = "", lines = 0; for (const ch of text) { const t = line + ch; if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); y += lh; line = ch; if (++lines >= maxLines - 1) { line += "…"; break; } } else line = t; } ctx.fillText(line, x, y); return y + lh; };
    ctx.textBaseline = "top";
    ctx.font = `600 22px ${sans}`; ctx.fillStyle = muted; ctx.fillText("ECHO POST · 回声邮局 · 夜班档案", 90, 120);
    ctx.textAlign = "right"; ctx.fillText(`No.${e.card.no} · ${e.card.date}`, W - 90, 120); ctx.textAlign = "left";
    ctx.font = `700 64px ${serif}`; ctx.fillStyle = ink; ctx.fillText(`《${e.card.title}》`, 90, 190);
    ctx.font = `26px ${sans}`; ctx.fillStyle = muted; ctx.fillText(`寄信人 ${e.card.from} · 回信人：你`, 90, 275);
    ctx.fillStyle = "rgba(42,36,32,.18)"; ctx.fillRect(90, 330, W - 180, 2);
    ctx.font = `26px ${sans}`; ctx.fillStyle = amber; ctx.fillText("回答人格", 90, 365);
    ctx.font = `700 58px ${serif}`; ctx.fillStyle = ink; ctx.fillText(e.card.persona, 90, 400);
    ctx.font = `26px ${sans}`; ctx.fillStyle = amber; ctx.fillText("结局", 90, 495);
    wrap(`${e.familyLabel} · ${e.depthLabel} · 真相 ${e.card.truths}`, 90, 530, W - 180, 40, `32px ${serif}`, ink, 2);
    ctx.font = `26px ${sans}`; ctx.fillStyle = amber; ctx.fillText(e.card.quoteLabel, 90, 620);
    let y = wrap(`「${e.quote}」`, 90, 660, W - 180, 52, `36px ${serif}`, ink, 4);
    y = Math.max(y + 20, 820);
    ctx.font = `26px ${sans}`; ctx.fillStyle = amber; ctx.fillText("五维评估", 90, y); y += 44;
    for (const k of keys) { ctx.font = `24px ${sans}`; ctx.fillStyle = muted; ctx.fillText(lab[k], 90, y); ctx.fillStyle = "rgba(42,36,32,.12)"; ctx.fillRect(230, y + 8, 500, 14); ctx.fillStyle = blue; ctx.fillRect(230, y + 8, 500 * e.scores[k] / 100, 14); ctx.font = `700 24px ${sans}`; ctx.fillStyle = ink; ctx.fillText(String(e.scores[k]), 750, y); y += 42; }
    ctx.font = `22px ${sans}`; ctx.fillStyle = muted; ctx.textAlign = "center"; ctx.fillText("知乎黑客松 2026 · 校园新锐季 · AI 游戏赛道", W / 2, H - 250); ctx.fillText("你的回答，会在一个陌生人的人生里发出回声。", W / 2, H - 216); ctx.textAlign = "left";
  };
  img.onload = draw; img.onerror = draw; if (img.complete) draw();
}

// ---------- 启动 / 恢复 ----------
statusEl.textContent = "连接邮局…";
(async () => {
  try {
    const h = await api("/api/health");
    if (h.budget?.mode === "classic") {
      const notice = $("#api-budget-notice"); notice.hidden = false; notice.textContent = h.budget.message;
    }
    const configured = h.capabilities?.credentialsConfigured, llm = h.llm !== "none";
    statusEl.className = "status " + (llm ? "live" : "demo");
    statusEl.innerHTML = `<span class="dot"></span>知乎参考台 · AI：${h.llm === "zhida" ? "直答已配置" : h.llm === "deepseek" ? "DeepSeek 已配置" : h.llm === "openai" ? "兼容模型已配置" : "规则引擎"}`;
    statusEl.title = `知乎热榜/搜索${configured ? "已配置，实际结果以来源标签为准" : "未配置凭证，使用演示降级"}；知识列表可独立查阅。模型已配置不代表本次生成成功。`;

  } catch { statusEl.innerHTML = `<span class="dot"></span>离线`; }
  // 恢复会话
  try {
    const saved = JSON.parse(sessionStorage.getItem("echo.state") || "null");
    if (saved?.sid && saved.view !== "home") {
      S.meta = await api("/api/letters");
      const b = await api(`/api/session/${saved.sid}/state`); adopt(b); const st = b.session;
      S.char = saved.char; S.sortAssign = st.phase === "sort" ? (saved.sortAssign || {}) : {};
      if (st.phase === "echo" && st.endingResult) return renderEcho(st.endingResult);
      if (st.phase === "echo") return renderHome();
      const r = st.phase === "sort" ? renderSort : st.phase === "talk" ? renderTalk : ["write", "revise", "review"].includes(st.phase) ? () => renderWrite(st.reply?.text || "") : renderRead;
      return r();
    }
  } catch { sessionStorage.removeItem("echo.state"); }
  renderHome();
})();
$("#brand").onclick = e => { e.preventDefault(); if (S.view !== "home" && !confirm("回到门厅会放下这封信，确定吗？")) return; sessionStorage.removeItem("echo.state"); renderHome(); };

