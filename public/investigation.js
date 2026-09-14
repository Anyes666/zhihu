// Present only information already released by the game. No API or state mutations.
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const categories = { fact:'事实', emotion:'情绪', demand:'诉求', bias:'偏见', avoidance:'逃避', clue:'关键线索' };
export function selectionMarkup(text) {
  if (!text) return '';
  return `<div class="selection-head"><b>当前选句 · 选一个分类</b><button class="btn ghost sm" type="button" id="selection-cancel">取消选中</button></div><blockquote tabindex="0">${esc(text)}</blockquote><div class="selection-choices">${Object.entries(categories).map(([id,label])=>`<button type="button" class="btn ghost sm" data-place="${id}">${label}</button>`).join('')}</div>`;
}
export function clueModel(letter, session) {
  const confirmed = session.truthsUnlocked || [];
  const known = new Set(confirmed.map(t=>t.id));
  return { facts: session.mailFacts || [], confirmed,
    pending: (session.leads || []).filter(l=>!known.has(l.truthId)).map(l=>({ id:l.segId, text:letter.body.find(b=>b.id===l.segId)?.text || '', hint:l.hint })).filter(l=>l.text) };
}
export function clueQuestion(text) {
  if (!text) return '这件事还有哪些细节需要确认？';
  return `关于「${String(text).slice(0,140)}」，你能说说具体发生了什么、还有什么需要确认吗？`;
}
export function writingMarkup() {
  return `<details class="writing-rails" open><summary>写作扶手 · 事实 / 感受 / 下一步</summary><ol><li><b>事实</b>：选一个已知细节作为依据；没问清的事保留疑问，不把猜测写成结论。</li><li><b>感受</b>：用自己的话回应对方的难处，不替对方定义感受。</li><li><b>下一步</b>：留一个可以尝试的小动作，也留下选择空间。</li></ol><p>不必填满三点，也没有标准稿。至少 10 字才能寄出；推荐 120–600 字。展开或收起说明不会修改草稿，外部参考不等于本案事实。</p></details>`;
}
export function modeDescription(health) {
  return health.llm === 'none' || health.budget?.mode === 'classic'
    ? '经典模式：无需登录也能完整体验；实时增强未开启。角色、线索与结局由规则引擎运行。'
    : '实时增强已配置；是否生成成功请看每段来源标签。规则决定线索与结局，不可用时自动回到经典文本。';
}
const moods = { guarded:'有所戒备', listening:'认真倾听', open:'逐渐敞开', withdrawn:'不愿多说' };
export function actionReceiptMarkup(receipt, { replayed = false, recovered = false } = {}) {
  if (!receipt) return '';
  const trust = receipt.trust, stamps = receipt.stamps;
  return `<h4>${replayed ? '重复请求 · 未再次扣费（以下为原回执）' : recovered ? '已核实服务端 · 恢复本次行动回执' : '本次提问 · 已受理'}</h4><p>提问邮票 <b>${stamps.before} → ${stamps.after}</b> · 信任 <b>${trust.before} → ${trust.after}（${trust.delta >= 0 ? '+' : ''}${trust.delta}）</b></p><p>规则识别：${esc(receipt.attitude.label)} · ${esc(moods[receipt.mood.before] || receipt.mood.before)} → ${esc(moods[receipt.mood.after] || receipt.mood.after)}${receipt.left ? ' · 角色已退出' : ''}</p><p>${receipt.newTruths.length ? '新确认：'+receipt.newTruths.map(t=>esc(t.title)).join('、') : '没有获得新证据。回应或信任变化不等于确认了新事实。'}</p><details><summary>为什么这样变化？查看规则记录</summary>${receipt.rules.map(r=>`<p>${esc(r)}</p>`).join('')}<p>这是固定规则记录，不是模型心理分析，也不保证下一问会解锁真相。</p></details><div class="receipt-next">${receipt.nextActions.filter(a=>['ask','summon','unlock','write'].includes(a.id)).map(a=>`<button type="button" class="btn ghost sm" data-receipt-action="${a.id}">${esc(a.label)}</button>`).join('')}</div>`;
}
