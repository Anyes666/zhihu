// 首次值班：状态由实际业务成功后的快照驱动，不自动触发游戏操作。
const KEY = 'echo.guide.v1';
const fresh = () => ({ version: 1, status: 'new', seen: [], sid: null });
export function restoreGuide(raw) {
  try {
    const s = JSON.parse(raw);
    if (s?.version === 1 && ['new', 'active', 'skipped', 'complete'].includes(s.status))
      return { version: 1, status: s.status, seen: Array.isArray(s.seen) ? s.seen.filter(x => typeof x === 'string') : [], sid: typeof s.sid === 'string' ? s.sid : null };
  } catch {}
  return fresh();
}
const step = (id, target, title, text, action, chapter) => ({ id, target, title, text, action, chapter });
export function guideStep(c, s) {
  if (s.status === 'new') return step('welcome', '#start-shift', '今晚，我陪你值第一班。', '先听，再判断，最后亲手回信。引导不替你选答案、不消耗机会；你可以随时跳过，也能从右下角重新开启。', '开始陪伴引导', '首次值班');
  if (s.status !== 'active' || c.busy) return null;
  const seen = id => s.seen.includes(id);
  switch (c.view) {
    case 'home': return step('home', '#start-shift', '选一个你愿意认真听的人', '点击「接过第一封信」，也可以往下挑另一封。没有必须选择的故事。', null, '启程');
    case 'read': return seen('read')
      ? step('read-next', '#go-sort', '读完后，开始拆信', '先不用决定该劝他做什么。下一步只分清：发生了什么，和他怎么看这件事。', null, '1 / 4 · 拆信')
      : step('read', '.read .paper h2', '先把这封信读完', '留意一句让你在意的话：它是在描述事实，还是在表达害怕？你现在的第一反应，也可以等到结尾再看一眼。', '读好了，下一步', '1 / 4 · 拆信');
    case 'sort':
      if (c.sortDone) return step('sort-done', '#go-talk', '分类不是为了给人贴标签', '看看哪些判断被纠正了。接下来可以向不同立场的人追问；你还不知道的事，可能比第一眼的结论重要。', null, '1 / 4 · 拆信');
      if (c.assigned === c.total && c.total > 0) return step('sort-seal', '#seal', '把你的理解交给邮局', '所有句子已归位。点击封存后才能看到反馈；现在仍可点分类里的小标签撤回修改。', null, '1 / 4 · 拆信');
      if (c.selected) return step('sort-place', '#trays', '再选一个合适的分类框', `${c.selectedText ? '已选：「' + c.selectedText.slice(0, 48) + (c.selectedText.length > 48 ? '…' : '') + '」。' : ''}看看六类的解释，点击你认为合适的框。分错也能继续故事。`, null, '1 / 4 · 拆信');
      return step('sort-pick', '.frag:not(.placed)', c.assigned ? '继续整理剩下的话' : '先点一句话', '点一句，再点分类框；也支持拖放。事实是可核对的经历，情绪是感受——“我觉得”不一定就是事实。', null, '1 / 4 · 拆信');
    case 'talk':
      if (!c.summoned) return step('cast', '.card[data-char]', '选一个人，给他留个座位', '圈出的是一个入口，四位都可以选。召唤用一次机会，开场白免费；不要急着把任何一人的立场当成全部真相。', null, '2 / 4 · 寻声');
      if (!c.talks && c.stamps > 0) return step('ask', '.compose', '问一句你真的想知道的话', '可以自由输入，也可点上方开口提示再修改。只有按「提问」才消耗 1 枚邮票。温和或具体的问法，可能让对方愿意多说。', null, '2 / 4 · 寻声');
      if (c.talks > 0 && !seen('listen')) return step('listen', '#msgs', '先听完，别急着找正确答案', '这是对你刚才问法的回应。看看对方的语气与线索变化；也可以继续问、换角色，或动用一次邮局档案。没问出真相不等于不能写好回信。', '我听到了', '2 / 4 · 寻声');
      if (!seen('research')) return c.researchOpen
        ? step('sources', '.research-desk > summary', '他人的经验，不是这个人的证据', '可以选一张知乎来源卡，记下启发与不适用之处。来源以页面标记为准；演示不是实时内容。查不到也没关系，不加分、不扣邮票。', '了解了，继续自由查阅', '2 / 4 · 知乎参考（可选）')
        : step('research', '#open-research', '去知乎找一个不同的视角', '点击参考台，看看哪些经验能提醒你、哪些不能照搬。查阅与写笔记都可选，不影响你继续回信。', '这次先不查', '2 / 4 · 知乎参考（可选）');
      return step('to-write', '#go-write', '准备好了，就把回应写给他', '你仍可继续对话或查资料。落笔后不能返回寻声；决定寄出前，想想还有什么是你需要问清的。', null, '2 / 4 · 寻声');
    case 'write': return c.reviewReady
      ? step('review', '#to-echo', '反馈是一面镜子，不是判决', '看看你的话是否贴合已知事实、是否留下余地。你可以用一次改稿机会，也可以直接去看一个月后的回响。', null, '3 / 4 · 落笔')
      : step('write', '#reply', '不是写满分答案，是回应一个人', '试着写下：你听见的一件事、理解的一种感受、今天能做的一件小事。不确定的部分请留白。至少 10 字可寄出；不会替你写。', '留点安静给我', '3 / 4 · 落笔');
    case 'echo':
      if (!c.endingReady) return null;
      return !seen('ending')
        ? step('ending', '#narr', '先看这个人，后来怎样了', '这是游戏里的可能结局，不是现实预测。先读完他的一个月，再去看赞同与评论——热闹和真正帮到人，不总是一回事。', '回看我的这封信', '4 / 4 · 回响')
        : step('reflection', '#first-reflection h2', '第一次值班，最后留一个问题', '回看看过的事实、问过的问题，以及你留下的那句话。如果再来一次，你会先问什么？下方「平行试写」可比较另一种回应，不改正式结局。', '完成首次值班', '4 / 4 · 留下回声');
    default: return null;
  }
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
  let state, context = {}, current, target, collapsed = false, memoryOnly = false, previousFocus;
  try { state = restoreGuide(localStorage.getItem(KEY)); } catch { state = fresh(); memoryOnly = true; }
  const root = document.createElement('div'); root.id = 'first-guide';
  root.innerHTML = `<div class="guide-ring" hidden></div><section class="guide-card" hidden role="region" aria-labelledby="guide-title"><div class="guide-topline"><span id="guide-chapter"></span><button type="button" id="guide-collapse" aria-label="收起提示，稍后继续">收起</button></div><h2 id="guide-title" tabindex="-1"></h2><p id="guide-text"></p><small id="guide-storage" hidden>浏览器无法保存进度；本次可用，关闭页面后可能再次提示。</small><div class="guide-actions"><button class="btn sm" id="guide-next"></button><button class="btn ghost sm" id="guide-skip">跳过引导</button></div><span class="guide-note">只圈选，不限制其他操作 · Esc 收起</span></section><button class="guide-help" type="button" id="guide-help">新手指引</button><span class="sr-only" id="guide-announcement" role="status" aria-live="polite"></span>`;
  document.body.appendChild(root);
  const $ = selector => root.querySelector(selector), card = $('.guide-card'), ring = $('.guide-ring'), help = $('#guide-help');
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { memoryOnly = true; } $('#guide-storage').hidden = !memoryOnly; };
  const restoreFocus = () => { if (root.contains(document.activeElement)) { const next = previousFocus?.isConnected && !root.contains(previousFocus) ? previousFocus : target?.querySelector('button,input,textarea') || target; if (next instanceof HTMLElement && !next.disabled) next.focus({preventScroll:true}); else help.focus({preventScroll:true}); } };
  const clear = () => { restoreFocus(); card.hidden = true; ring.hidden = true; document.body.classList.remove('guide-visible'); help.hidden = false; };
  function position(scroll = false) {
    if (card.hidden) return;
    const vv = window.visualViewport, width = vv?.width || innerWidth, height = vv?.height || innerHeight, offsetY = vv?.offsetTop || 0;
    const mobile = width <= 760;
    const compact = mobile && height < 680; card.classList.toggle('guide-compact', compact);
    $('#guide-text').textContent = compact && current?.id === 'sort-place' ? '点选合适的分类；所有六类都可选。可收起提示查看原句。' : current?.text || '';
    const cardHeight = card.offsetHeight;
    document.documentElement.style.setProperty('--guide-space', mobile ? `${cardHeight + 28}px` : '0px');
    card.style.left = mobile ? '12px' : `${Math.max(12, width - card.offsetWidth - 24)}px`;
    card.style.top = `${offsetY + Math.max(12, height - cardHeight - (mobile ? 12 : 24))}px`;
    target = current?.target ? document.querySelector(current.target) : null;
    if (!target || !target.getClientRects().length) { ring.hidden = true; return; }
    if (scroll) {
      const top = document.querySelector('.top')?.getBoundingClientRect().bottom || 60;
      const r = target.getBoundingClientRect(), available = height - cardHeight - top - 42;
      const desired = Math.max(top + 18, top + available / 2 - Math.min(r.height, available) / 2);
      window.scrollBy({top:r.top - desired,behavior:'instant'});
    }
    const r = target.getBoundingClientRect(), top = Math.max(offsetY + 6, r.top - 5), bottom = Math.min(offsetY + height - 6, r.bottom + 5);
    ring.hidden = bottom <= top || r.right <= 0 || r.left >= width;
    Object.assign(ring.style, { left: `${Math.max(4, r.left - 5)}px`, top: `${top}px`, width: `${Math.max(0,Math.min(width-4,r.right+5)-Math.max(4,r.left-5))}px`, height: `${Math.max(0,bottom-top)}px` });
    // Desktop: when a right-side control is highlighted, move the card to the left.
    if (!mobile) { const cr = card.getBoundingClientRect(); if (r.right > cr.left && r.left < cr.right && r.bottom > cr.top && r.top < cr.bottom) card.style.left = '24px'; }
  }
  function render() {
    const next = guideStep(context,state);
    help.textContent = state.status === 'active' || state.status === 'new' ? '继续指引' : '新手指引';
    if (!next || collapsed || (next.id === 'write' && state.seen.includes('write'))) { current = next; clear(); return; }
    const changed = current?.id !== next.id || card.hidden;
    current = next;
    if (changed) previousFocus = document.activeElement;
    card.hidden = false; help.hidden = true; document.body.classList.add('guide-visible'); card.dataset.step = next.id;
    $('#guide-chapter').textContent = next.chapter;
    $('#guide-title').textContent = next.title; $('#guide-text').textContent = next.text;
    $('#guide-next').hidden = !next.action; $('#guide-next').textContent = next.action || '';
    $('#guide-skip').textContent = next.id === 'welcome' ? '自己探索' : '跳过引导';
    $('#guide-storage').hidden = !memoryOnly;
    if (changed) $('#guide-announcement').textContent = `${next.chapter}。${next.title}。${next.text}`;
    position(changed);
  }
  $('#guide-next').onclick = () => {
    if (!current) return;
    if (current.id === 'welcome') state.status = 'active';
    else if (current.id === 'reflection') { state.status = 'complete'; $('#guide-announcement').textContent = '首次值班引导已完成。可以继续复盘或再接一封信。'; }
    else state.seen = [...new Set([...state.seen, current.id === 'sources' ? 'research' : current.id])];
    persist(); render();
  };
  $('#guide-skip').onclick = () => { state.status = 'skipped'; persist(); render(); $('#guide-announcement').textContent = '引导已跳过，游戏进度不变。右下角可以重新开启。'; };
  const collapse = () => { collapsed = true; clear(); help.textContent = '继续指引'; help.focus({preventScroll:true}); };
  $('#guide-collapse').onclick = collapse;
  help.onclick = () => { previousFocus = document.activeElement; collapsed = false; if (state.status !== 'active' && state.status !== 'new') state = {...fresh(),status:'active',sid:context.sid || null}; state.seen = state.seen.filter(id => id !== 'write'); persist(); render(); if (!card.hidden) $('#guide-title').focus({preventScroll:true}); };
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !card.hidden) { event.preventDefault(); collapse(); } });
  window.addEventListener('resize', () => position(true)); window.addEventListener('scroll', () => position(), {passive:true});
  window.visualViewport?.addEventListener('resize', () => position()); window.visualViewport?.addEventListener('scroll', () => position());
  const resize = new ResizeObserver(() => position()); resize.observe(document.querySelector('#app')); resize.observe(card);
  return { sync(next) { context = next; if (next.sid && next.sid !== state.sid) { state.sid = next.sid; state.seen = []; persist(); } render(); }, suspend() { current = null; clear(); } };
}
