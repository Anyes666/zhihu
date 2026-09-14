// 引导只持久化自己的元数据，不读取或写入游戏、草稿和资源。
// 保留旧键，v1 的退出选择与已读步骤迁入 v2，不强制旧玩家补练习。
const KEY = 'echo.guide.v1';
const fresh = () => ({ version: 2, status: 'new', seen: [], sid: null, practice: 'pending' });
export function restoreGuide(raw) {
  try {
    const s = JSON.parse(raw);
    if ([1, 2].includes(s?.version) && ['new', 'active', 'skipped', 'complete'].includes(s.status)) {
      return {
        version: 2, status: s.status,
        seen: Array.isArray(s.seen) ? s.seen.filter(x => typeof x === 'string') : [],
        sid: typeof s.sid === 'string' ? s.sid : null,
        practice: s.version === 2 && ['pending', 'complete', 'skipped'].includes(s.practice)
          ? s.practice : s.status === 'new' ? 'pending' : 'skipped',
      };
    }
  } catch {}
  return fresh();
}

// 独立原创例句；不得导入正式来信或把练习结果交给游戏业务。
export const PRACTICE_SENTENCES = [
  { id: 'practice-fact', text: '今天下午，我把两本借来的图册放回了书架。', category: 'fact', reason: '归还图册的时间、数量和动作可以核对，是可核实的陈述。' },
  { id: 'practice-emotion', text: '想到明天要第一次参加合唱排练，我有些紧张。', category: 'emotion', reason: '这句话主要在表达「紧张」这一主观感受，而不是报告可核实的行动。' },
];
export const CATEGORY_HELP = [
  { id: 'fact', label: '事实', explanation: '可以核对的经历或行动；可核实不等于已经证实。', example: '我把两本图册放回了书架。' },
  { id: 'emotion', label: '情绪', explanation: '当事人的主观感受，不需要用对错否定它。', example: '第一次参加合唱排练，我有些紧张。' },
  { id: 'demand', label: '诉求', explanation: '想得到的帮助、改变或被满足的需要。', example: '我希望练习前有人带我熟悉节奏。' },
  { id: 'bias', label: '偏见', explanation: '把有限经历当成普遍结论，或未经核实就替别人下判断。', example: '节奏跟不上的人肯定都不认真。' },
  { id: 'avoidance', label: '逃避', explanation: '为了躲开不适，回避要面对的问题或行动。', example: '我干脆不看排练通知，就不用面对出错了。' },
  { id: 'clue', label: '关键线索', explanation: '可能改变理解、值得继续追问的具体细节；仍需结合上下文核实。', example: '通知写着排练在二楼，门上的纸条却写三楼，值得问清原因。' },
];
export const freshPractice = () => ({ selected: null, completed: [], feedback: null });
export function practiceAction(state, event) {
  if (event.type === 'restart') return freshPractice();
  if (event.type === 'select') {
    if (!PRACTICE_SENTENCES.some(s => s.id === event.id) || state.completed.includes(event.id)) return state;
    return { ...state, selected: event.id, feedback: null };
  }
  if (event.type !== 'classify' || !['fact', 'emotion'].includes(event.category)) return state;
  const sentence = PRACTICE_SENTENCES.find(s => s.id === state.selected);
  if (!sentence || state.completed.includes(sentence.id)) return state;
  const correct = sentence.category === event.category;
  return {
    selected: correct ? null : state.selected,
    completed: correct ? [...state.completed, sentence.id] : [...state.completed],
    feedback: { correct, message: `${correct ? '分对了：' : '再试一次：'}${sentence.reason}${correct ? '' : '保留这句，再选一个类别即可重试。'}` },
  };
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function practiceMarkup(state) {
  const selected = PRACTICE_SENTENCES.find(s => s.id === state.selected);
  return `<p class="practice-progress">已完成 ${state.completed.length} / 2 · 不计分、不使用游戏资源</p>
    <div class="practice-sentences" role="group" aria-label="先点一句练习句子">${PRACTICE_SENTENCES.map(s => `<button type="button" data-practice-sentence="${s.id}" aria-pressed="${state.selected === s.id}" ${state.completed.includes(s.id) ? 'disabled' : ''}>${esc(s.text)}${state.completed.includes(s.id) ? '<span>已完成</span>' : ''}</button>`).join('')}</div>
    <p id="guide-practice-selected">${selected ? `已选：「${esc(selected.text)}」` : state.completed.length === 2 ? '两句练习已完成，可以继续或重玩。' : '先点一句，再选择下面的类别。'}</p>
    <fieldset id="guide-practice-categories" ${selected ? '' : 'disabled'}><legend>把已选句子分到哪一类？</legend>${CATEGORY_HELP.slice(0, 2).map(c => `<button type="button" data-practice-category="${c.id}">${c.label}</button>`).join('')}</fieldset>
    <p id="guide-practice-feedback" role="status" aria-live="polite" aria-atomic="true" data-result="${state.feedback ? state.feedback.correct ? 'correct' : 'incorrect' : 'none'}">${esc(state.feedback?.message || '')}</p>`;
}

// 保留 id/target/title/text/action/chapter，新增显式三段字段供集成方读取。
const step = (id, target, goal, instruction, outcome, action, chapter, note = '') => ({
  id, target, title: goal, text: `当前目标：${goal}。具体动作：${instruction}。完成后：${outcome}。${note}`,
  action, chapter, goal, instruction, outcome, note,
});
export function guideStep(c, s) {
  if (s.status === 'new') return step('welcome', '#start-shift', '读懂一封来信，亲手回应', '点击「试做两句练习」，也可自己探索', '先练习区分事实与情绪，再进入正式故事', '试做两句练习', '首次值班', '完整版在页面底部「游戏介绍与玩法」，按需展开即可。无需登录，练习不联网、不计分。');
  if (s.status !== 'active' || c.busy) return null;
  if (s.practice === 'pending') return step('practice', '#guide-practice', '先分清事实和感受', '先点一句原创练习句，再点事实或情绪', '立即看到一句理由；分错可重试，不影响正式故事', null, '独立练习 · 可跳过');
  const seen = id => s.seen.includes(id);
  switch (c.view) {
    case 'home':
      if (!seen('introduction')) return step('introduction', '#game-intro-content', '先听，再判断，最后回信', '点击「去选一封信」；需要时再展开底部「游戏介绍与玩法」', '进入选信，不必重复阅读介绍', '去选一封信', '启程 · 玩法摘要');
      return step('home', '#start-shift', '选一封你愿意认真听的信', '点击「接过第一封信」，或另选一封来信', '展开这封信，开始阅读', null, '启程');
    case 'read': return seen('read')
      ? step('read-next', '#go-sort', '把来信拆成可以理解的句子', '点击「开始拆信」', '进入六类分类区，尚不提交判断', null, '1 / 4 · 拆信')
      : step('read', '.read .paper h2', '先把这封信读完', '读完来信，再点「读好了，下一步」', '看到开始拆信的入口；不会替你选答案', '读好了，下一步', '1 / 4 · 拆信');
    case 'sort':
      if (c.sortDone) return step('sort-done', '#go-talk', '看看分类反馈，再找人追问', '阅读纠正理由，点击「去寻声」', '进入角色选择，继续了解不同立场', null, '1 / 4 · 拆信');
      if (c.assigned === c.total && c.total > 0) return step('sort-seal', '#seal', '提交这一轮分类', '点击「封存」；提交前仍可点击已分类标签撤回', '显示分类反馈，之后可以去寻声', null, '1 / 4 · 拆信');
      if (c.selected) return step('sort-place', '#sort-selection', '给选中的句子分类', '在完整选句下，点击你认为合适的类别', '句子进入该类，已分类数量增加；仍可撤回', null, '1 / 4 · 拆信');
      return step('sort-pick', '.frag:not(.placed)', c.assigned ? '继续整理剩下的句子' : '选一句话来判断', '点击一条尚未归类的句子', '完整选句会显示在分类区上方，再选择类别', null, '1 / 4 · 拆信');
    case 'talk':
      if (!c.summoned) return step('cast', '.card[data-char]', '找一个人了解另一面', '点击一张角色卡，邀请他入座', '使用一次邀请机会，先听免费开场白', null, '2 / 4 · 寻声');
      if (!c.talks && c.stamps > 0) return step('ask', '.compose', '问清一件你还不知道的事', '输入具体问题，点击「提问」发送', '发送成功后使用 1 枚邮票，收到角色回应', null, '2 / 4 · 寻声');
      if (c.talks > 0 && !seen('listen')) return step('listen', '#msgs', '看见这次提问带来的变化', '读刚收到的回答，看看语气和线索，再点「我听到了」', '可继续追问、换人，或前往参考台', '我听到了', '2 / 4 · 寻声');
      if (!seen('research')) return c.researchOpen
        ? step('sources', '.research-desk > summary', '借鉴经验，但不把它当本案证据', '按需查看来源与适用边界，再点「继续」', '回到自由调查；查不到也不影响回信', '继续', '2 / 4 · 知乎参考（可选）', '来源以页面标记为准，演示不是实时内容。')
        : step('research', '#open-research', '选择是否参考他人经验', '点击参考台查看来源，或点「这次先不查」', '得到参考视角或直接继续；不会扣提问邮票', '这次先不查', '2 / 4 · 知乎参考（可选）');
      return step('to-write', '#go-write', '准备好后再开始回信', '确认没有要追问的问题，再点击「去落笔」', '进入回信页；落笔后不能返回寻声', null, '2 / 4 · 寻声');
    case 'write': return c.reviewReady
      ? step('review', '#to-echo', '对照反馈，决定是否改稿', '阅读反馈，按需改稿，或点击「去看回响」', '查看寄信人一个月后的可能结局', null, '3 / 4 · 落笔')
      : step('write', '#reply', '用自己的话回应一个人', '写下听见的事实、理解的感受和可做的小事；至少 10 字可寄出', '寄出后收到反馈；不会替你写，也不要求满分答案', '留点安静给我', '3 / 4 · 落笔');
    case 'echo':
      if (!c.endingReady) return null;
      return !seen('ending')
        ? step('ending', '#narr', '看这封回应带来的可能回响', '读完一个月后的叙述，点击「回看我的这封信」', '回顾本局提问与回信，而非预测现实人生', '回看我的这封信', '4 / 4 · 回响')
        : step('reflection', '#first-reflection h2', '带走一个下次愿意问的问题', '回看自己的提问和表达，再点「完成首次值班」', '结束引导；仍可平行试写，不改正式结局', '完成首次值班', '4 / 4 · 留下回声');
    default: return null;
  }
}

export function reflectionMarkup(session, ending) {
  const talks = session?.talks || [], truths = session?.truthsUnlocked || [], missed = ending?.missed || [];
  const last = talks.at(-1);
  return `<section class="first-reflection panel" id="first-reflection" aria-labelledby="reflection-title">
    <div class="eyebrow">不是通关评语 · 是你的这一次选择</div><h2 id="reflection-title">刚拆信时，你也是这样想的吗？</h2>
    <p class="reflection-lead">故事暂时停在这里。你不必拯救一个人，也可以先不急着替他决定。</p>
    <div class="reflection-grid"><article><h3>你选择问出的</h3>${last ? `<blockquote>${esc(last.q)}</blockquote><small>你向 ${esc(last.name || '角色')} 提出的最后一个问题 · 共追问 ${talks.length} 次</small>` : '<p>这次你没有向角色追问。下次，也许可以先给沉默的人一个开口的机会。</p>'}</article>
    <article><h3>${ending?.quoteRisky ? '需要重新掂量的那句话' : '你亲手留下的'}</h3><blockquote>${esc(ending?.quote || session?.reply?.text?.slice(0, 120) || '这封回应，已经属于你。')}</blockquote><small>${ending?.quoteRisky ? '规则检测到可能伤人的措辞；展示是为了回看，不是对这句话的认可。' : '来自本局回信，不是为你生成的赞美。'}</small></article></div>
    <p class="reflection-facts">本局知道了 ${truths.length} 层真相${truths.length ? '：' + truths.map(t => esc(t.title)).join('、') : ''}。${missed.length ? '还没问到：' + missed.map(t => esc(t.title)).join('、') + '。未问到不代表你不在乎，只是提醒我们，第一眼未必是全貌。' : '故事里的线索已经收齐，但这不等于能替当事人做决定。'}</p>
    <details><summary>带走一个问题，不必在这里回答</summary><p>下一次有人向我倾诉时，我愿不愿意在给建议之前，多问一句「你最担心的是什么」？</p><p class="muted">不收集你的答案。若想重写一句话，可继续下方平行试写；它只是规则对照，不是现实人生的预测。</p></details>
  </section>`;
}

export function mountGuide() {
  let state, context = {}, current, collapsed = false, memoryOnly = false;
  let practice = freshPractice(), practiceReplay = false, visibility = '';
  try { state = restoreGuide(localStorage.getItem(KEY)); } catch { state = fresh(); memoryOnly = true; }
  const root = document.createElement('div'); root.id = 'first-guide';
  root.innerHTML = `<div class="guide-ring" hidden aria-hidden="true"></div>
    <section class="guide-card" hidden role="region" aria-labelledby="guide-title">
      <div class="guide-topline"><span id="guide-chapter"></span><button type="button" id="guide-collapse" aria-label="收起提示，稍后继续">收起</button></div>
      <h2 id="guide-title"></h2><p id="guide-text"></p><p id="guide-note" hidden></p>
      <div id="guide-practice" hidden>${practiceMarkup(practice)}</div>
      <small id="guide-storage" hidden>浏览器无法保存引导进度；本次仍可练习，关闭页面后可能再次提示。</small>
      <div class="guide-actions"><button type="button" class="btn sm" id="guide-next"></button><button type="button" class="btn ghost sm" id="guide-practice-skip" hidden>跳过练习</button><button type="button" class="btn ghost sm" id="guide-skip">跳过引导</button></div>
    </section>
    <div class="guide-tools"><button class="guide-help" type="button" id="guide-help">新手指引</button><button class="guide-help" type="button" id="guide-practice-replay">重玩两句练习</button>
      <details id="guide-category-help"><summary>六类帮助 · 解释与例子</summary><div class="guide-category-grid">${CATEGORY_HELP.map(c => `<article data-guide-category="${c.id}"><h3>${c.label}</h3><p>${esc(c.explanation)}</p><p><b>例：</b>${esc(c.example)}</p></article>`).join('')}</div></details>
    </div><span class="sr-only" id="guide-announcement" role="status" aria-live="polite"></span>`;
  const app = document.querySelector('#app');
  if (app) app.parentNode.insertBefore(root, app); else document.body.appendChild(root);
  const $ = selector => root.querySelector(selector), card = $('.guide-card'), ring = $('.guide-ring'), help = $('#guide-help');
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { memoryOnly = true; } $('#guide-storage').hidden = !memoryOnly; };
  const markSeen = id => { state.seen = [...new Set([...state.seen, id])]; };
  function announceVisibility(visible) {
    document.body.classList.toggle('guide-visible', visible);
    const key = `${visible}:${visible ? current?.id : ''}`;
    if (key === visibility) return;
    visibility = key;
    // 集成方可隐藏重复的主提示，不传递练习答案或触发游戏操作。
    document.dispatchEvent(new CustomEvent('guide:visibility', { detail: { visible, step: visible ? current?.id : null } }));
  }
  function clear() {
    card.hidden = true; ring.hidden = true; help.hidden = false;
    announceVisibility(false);
  }
  function park() {
    if (app && (root.parentNode !== app.parentNode || root.nextSibling !== app)) app.parentNode.insertBefore(root, app);
  }
  function place(next) {
    // 就近放在稳定容器；分类选句/归类循环始终用同一位置，不逐句搬动。
    // 当玩家正在操作引导本身时，不搬动持有焦点的子树。
    if (root.contains(document.activeElement) || next.id === 'practice' || next.id === 'welcome') return;
    if (context.view === 'home') { park(); return; }
    if (context.view === 'sort' && !context.sortDone) {
      const trays = document.querySelector('#trays');
      if (trays && root.parentNode !== trays) trays.insertBefore(root, trays.firstChild);
      return;
    }
    const selector = next.id === 'cast' ? '#cast' : next.target;
    const target = document.querySelector(selector);
    if (!target || root.contains(target)) return;
    if (next.id === 'cast') {
      if (root.parentNode !== target) target.insertBefore(root, target.firstChild);
    } else if (root.parentNode !== target.parentNode || root.nextSibling !== target) {
      target.parentNode.insertBefore(root, target);
    }
  }
  function position() {
    if (card.hidden || current?.id === 'practice') { ring.hidden = true; return; }
    // 只画无交互边框：不移动卡片、不滚动页面，也不改焦点。
    const target = current?.target && (document.querySelector(current.target)
      || (current.id === 'sort-place' ? document.querySelector('#trays') : null));
    if (!target || !target.getClientRects().length) { ring.hidden = true; return; }
    const vv = window.visualViewport, width = vv?.width || window.innerWidth;
    const height = vv?.height || window.innerHeight, offsetY = vv?.offsetTop || 0;
    const r = target.getBoundingClientRect(), top = Math.max(offsetY + 6, r.top - 5);
    const bottom = Math.min(offsetY + height - 6, r.bottom + 5);
    const left = Math.max(4, r.left - 5), right = Math.min(width - 4, r.right + 5);
    ring.hidden = bottom <= top || right <= left;
    Object.assign(ring.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(0, right-left)}px`, height: `${Math.max(0, bottom-top)}px` });
  }
  function renderPractice() {
    // 更新现有节点而非替换 innerHTML：错误重试保留按钮焦点与 live region。
    for (const sentence of PRACTICE_SENTENCES) {
      const button = $(`[data-practice-sentence="${sentence.id}"]`), done = practice.completed.includes(sentence.id);
      button.disabled = done;
      button.setAttribute('aria-pressed', String(practice.selected === sentence.id));
      button.textContent = `${sentence.text}${done ? ' · 已完成' : ''}`;
    }
    const selected = PRACTICE_SENTENCES.find(s => s.id === practice.selected);
    $('#guide-practice-selected').textContent = selected ? `已选：「${selected.text}」`
      : practice.completed.length === 2 ? '两句练习已完成，可以继续或重玩。' : '先点一句，再选择下面的类别。';
    $('#guide-practice-categories').disabled = !selected;
    $('.practice-progress').textContent = `已完成 ${practice.completed.length} / 2 · 不计分、不使用游戏资源`;
    const feedback = $('#guide-practice-feedback');
    feedback.dataset.result = practice.feedback ? practice.feedback.correct ? 'correct' : 'incorrect' : 'none';
    feedback.textContent = practice.feedback?.message || '';
  }
  function render() {
    let next = guideStep(context, practiceReplay ? { ...state, status: 'active', practice: 'pending' } : state);
    help.textContent = state.status === 'active' || state.status === 'new' ? '继续指引' : '新手指引';
    const modalOpen = !!document.querySelector('#zhihu-dialog')?.open;
    $('.guide-tools').hidden = modalOpen;
    if (modalOpen) { clear(); return; }
    if (!next || collapsed || (next.id === 'write' && state.seen.includes('write'))) { current = next; clear(); return; }
    if (next.id === 'practice') {
      const done = practice.completed.length === PRACTICE_SENTENCES.length;
      next = { ...next,
        goal: done ? '你已试过区分事实与感受' : practice.selected ? '给选中的练习句分类' : '先选一句练习句',
        instruction: done ? '点击「继续正式引导」，或重玩两句' : practice.selected ? '点击下方「事实」或「情绪」' : '点击一条尚未完成的句子',
        outcome: done ? '回到当前游戏阶段，游戏进度与资源不变' : practice.selected ? '立即看到理由，选错可原位重试' : '完整选句会显示在类别上方',
        action: done ? '继续正式引导' : null,
      };
      renderPractice();
    }
    const changed = current?.id !== next.id || current?.instruction !== next.instruction || card.hidden;
    current = next;
    card.hidden = false; help.hidden = true; card.dataset.step = next.id;
    $('#guide-chapter').textContent = next.chapter;
    $('#guide-title').textContent = `当前目标：${next.goal}`;
    $('#guide-text').textContent = `具体动作：${next.instruction}。完成后：${next.outcome}。`;
    $('#guide-note').textContent = next.note; $('#guide-note').hidden = !next.note;
    $('#guide-practice').hidden = next.id !== 'practice';
    $('#guide-practice-skip').hidden = next.id !== 'practice';
    $('#guide-next').hidden = !next.action; $('#guide-next').textContent = next.action || '';
    $('#guide-skip').textContent = next.id === 'welcome' ? '自己探索' : '跳过引导';
    $('#guide-storage').hidden = !memoryOnly;
    // 练习理由只由自身 live region 播报，不再叠加一条主提示。
    if (changed && next.id !== 'practice') $('#guide-announcement').textContent = `${next.chapter}。${next.text}`;
    place(next); announceVisibility(true); position();
  }
  function finishPractice(status) {
    practiceReplay = false; state.practice = status; markSeen('introduction'); persist(); render();
    if (card.hidden) help.focus({ preventScroll: true });
  }
  $('#guide-practice').onclick = event => {
    if (current?.id !== 'practice' || collapsed || card.hidden) return;
    const sentence = event.target.closest('[data-practice-sentence]');
    const category = event.target.closest('[data-practice-category]');
    if (!sentence && !category) return;
    const next = practiceAction(practice, sentence ? { type: 'select', id: sentence.dataset.practiceSentence }
      : { type: 'classify', category: category.dataset.practiceCategory });
    if (next === practice) return;
    practice = next; render();
    // 只有用户明确完成分类时，才接续键盘操作到下一句/继续按钮。
    if (category && practice.feedback?.correct) {
      const remaining = PRACTICE_SENTENCES.find(s => !practice.completed.includes(s.id));
      (remaining ? $(`[data-practice-sentence="${remaining.id}"]`) : $('#guide-next')).focus({ preventScroll: true });
    }
  };
  $('#guide-next').onclick = () => {
    if (!current) return;
    if (current.id === 'welcome') { state.status = 'active'; state.practice = 'pending'; markSeen('introduction'); }
    else if (current.id === 'practice') { if (practice.completed.length === 2) finishPractice('complete'); return; }
    else if (current.id === 'reflection') state.status = 'complete';
    else markSeen(current.id === 'sources' ? 'research' : current.id);
    const ownedFocus = card.contains(document.activeElement);
    persist(); render();
    if (ownedFocus && card.hidden) help.focus({ preventScroll: true });
  };
  $('#guide-practice-skip').onclick = () => { finishPractice('skipped'); if (card.hidden) help.focus({ preventScroll: true }); };
  $('#guide-skip').onclick = () => {
    practiceReplay = false; state.status = 'skipped'; persist(); render(); help.focus({ preventScroll: true });
    $('#guide-announcement').textContent = '引导已跳过，游戏进度不变。页面上方「新手指引」可重新开启。';
  };
  const collapse = () => { collapsed = true; clear(); help.textContent = '继续指引'; help.focus({ preventScroll: true }); };
  $('#guide-collapse').onclick = collapse;
  help.onclick = () => {
    collapsed = false;
    if (!practiceReplay && !['active', 'new'].includes(state.status)) state = { ...state, status: 'active', seen: ['introduction'], practice: state.practice === 'complete' ? 'complete' : 'skipped' };
    state.seen = state.seen.filter(id => id !== 'write'); persist(); render();
  };
  const replayPractice = () => {
    practice = practiceAction(practice, { type: 'restart' });
    // 独立重玩不改已跳过/已完成的引导选择，刷新也不会强制恢复正式教学。
    practiceReplay = true; collapsed = false; persist(); render();
  };
  $('#guide-practice-replay').onclick = replayPractice;
  document.addEventListener('echo:auth-modal', render);
  document.addEventListener('keydown', event => {
    // 不拦截游戏输入区的 Escape，只有提示自身持有焦点才处理。
    if (event.key === 'Escape' && !card.hidden && card.contains(event.target)) { event.preventDefault(); collapse(); }
  });
  window.addEventListener('resize', position); window.addEventListener('scroll', position, { passive: true });
  window.visualViewport?.addEventListener('resize', position); window.visualViewport?.addEventListener('scroll', position);
  if (typeof ResizeObserver !== 'undefined') { const resize = new ResizeObserver(position); if (app) resize.observe(app); resize.observe(card); }
  render();
  return {
    sync(next) {
      context = next;
      if (next.sid && next.sid !== state.sid) { state.sid = next.sid; state.seen = state.seen.filter(id => id === 'introduction'); persist(); }
      render();
    },
    suspend() { current = null; clear(); park(); },
    replayPractice,
  };
}
