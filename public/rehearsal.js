const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dims = { demand:'诉求',accuracy:'事实',warmth:'温度',safety:'安全',community:'表达' };
const mounts = new WeakMap();

function validateComparison(data) {
  const complete = data?.simulation === true && data.generated === false && typeof data.boundary === 'string'
    && typeof data.changed === 'boolean' && Array.isArray(data.textDiff) && data.delta
    && [data.original, data.alternate].every(item => item && ['text','family','familyLabel','depth','depthLabel','quote'].every(key => typeof item[key] === 'string')
      && Array.isArray(item.narrative) && item.narrative.every(p => typeof p === 'string')
      && Object.keys(dims).every(key => Number.isFinite(item.scores?.[key]) && item.scores[key] >= 0 && item.scores[key] <= 100))
    && data.textDiff.every(part => part && ['unchanged','removed','added'].includes(part.type) && typeof part.text === 'string');
  if (!complete) throw Error('试写数据不完整');
  for (const item of [data.original, data.alternate]) validateEvidence(item.evidence);
  const rebuild = excluded => data.textDiff.filter(p => p.type !== excluded).map(p => p.text).join('');
  if (rebuild('added') !== data.original.text || rebuild('removed') !== data.alternate.text
    || data.changed !== (data.original.family !== data.alternate.family)
    || Object.keys(dims).some(key => data.delta[key] !== data.alternate.scores[key] - data.original.scores[key])) throw Error('试写数据不一致');
}

// Evidence labels and coverage levels come from the engine; never infer them from depth.
function validateEvidence(evidence) {
  if (evidence == null) return;
  const confirmed = evidence.confirmed, coverage = evidence.coverage;
  const confirmedValid = confirmed && Number.isInteger(confirmed.count) && Number.isInteger(confirmed.total)
    && confirmed.count >= 0 && confirmed.count <= confirmed.total && confirmed.total > 0 && typeof confirmed.label === 'string';
  const coverageValid = coverage === null || (coverage && confirmedValid && Number.isFinite(coverage.score)
    && coverage.score >= 0 && coverage.score <= coverage.total && coverage.total === confirmed.total
    && ['full','partial','blind'].includes(coverage.level) && typeof coverage.label === 'string'
    && Number.isInteger(coverage.confirmedMentioned) && coverage.confirmedMentioned >= 0 && coverage.confirmedMentioned <= confirmed.count);
  if (!confirmedValid || !coverageValid) throw Error('试写依据记录不完整');
}

function evidenceMarkup(evidence) {
  if (evidence == null) return '<div class="parallel-evidence" data-evidence-status="unrecorded"><p>本稿未记录已确认真相与回信依据覆盖；不推断旧档案数据。</p></div>';
  const {confirmed, coverage} = evidence;
  return `<div class="parallel-evidence" data-evidence-status="recorded"><p class="parallel-confirmed">${esc(confirmed.label)}</p>${coverage
    ? `<p class="parallel-coverage" data-coverage-level="${coverage.level}" data-coverage-score="${coverage.score}">${esc(coverage.label)}</p><p class="muted">规则覆盖值 ${coverage.score}/${coverage.total} · 提及已确认真相 ${coverage.confirmedMentioned} 条</p>`
    : '<p class="parallel-coverage" data-coverage-status="unrecorded">尚无回信依据覆盖记录。</p>'}</div>`;
}

function evidenceComparison(original, alternate) {
  if (!original || !alternate) return '至少一稿未记录依据数据，无法比较依据覆盖；不补算旧档案。';
  const sameConfirmed = original.confirmed.count === alternate.confirmed.count && original.confirmed.total === alternate.confirmed.total;
  const confirmation = sameConfirmed ? '已确认数量不变' : '两稿已确认记录不一致，不能解释为试写新增真相';
  const a = original.coverage, b = alternate.coverage;
  if (!a || !b) return `${confirmation}；至少一稿尚无覆盖记录，无法比较依据覆盖。`;
  if (a.total !== b.total) return `${confirmation}；覆盖总量不一致，无法比较依据覆盖。`;
  const sameCoverage = a.score === b.score && a.level === b.level && a.confirmedMentioned === b.confirmedMentioned;
  return `${confirmation}；${sameCoverage ? '依据覆盖不变' : `依据覆盖值 ${a.score} → ${b.score}；提及已确认真相 ${a.confirmedMentioned} → ${b.confirmedMentioned} 条`}。覆盖值是规则汇总，不是已确认真相数量。`;
}

function rulesMarkup(item) {
  const summary = item.ruleSummary || {};
  const groups = {demandHits:'诉求关键词命中',factHits:'事实关键词命中',wrong:'错误说法命中',riskyHits:'风险措辞命中'};
  const records = Object.entries(groups).filter(([key]) => Array.isArray(summary[key]))
    .map(([key, label]) => `<li>${label}：${summary[key].length ? summary[key].map(value => `「${esc(value)}」`).join('、') : '未命中'}</li>`);
  for (const [key, label] of [['absolutes','绝对化用语计数'],['imperatives','命令式用语计数']]) {
    if (Number.isFinite(summary[key])) records.push(`<li>${label}：${esc(summary[key])}</li>`);
  }
  if (typeof summary.talkFirst === 'boolean') records.push(`<li>先沟通表达：${summary.talkFirst ? '命中' : '未命中'}</li>`);
  return records.length ? `<ul>${records.join('')}</ul>` : '<p>本稿未提供规则记录。</p>';
}

export function rehearsalResultMarkup(data) {
  validateComparison(data);
  const changedText = data.original.text !== data.alternate.text;
  const draft = (side, label) => `<article data-draft="${side}"><h4>${label}</h4><p class="parallel-diff-text">${data.textDiff
    .filter(part => part.type !== (side === 'original' ? 'added' : 'removed'))
    .map(part => part.type === 'unchanged' ? esc(part.text) : `<${part.type === 'removed' ? 'del' : 'ins'} data-text-change="${part.type}">${esc(part.text)}</${part.type === 'removed' ? 'del' : 'ins'}>`).join('')}</p></article>`;
  const outcome = (item, label) => `<article><span class="tag">${label}</span><h3>${esc(item.familyLabel)}</h3><span class="muted">同一份已知事实 · 未新增确认线索</span>${evidenceMarkup(item.evidence)}<p class="parallel-quote ${item.quoteRisky ? 'risky' : ''}">${item.quoteRisky ? '风险措辞 · ' : ''}「${esc(item.quote)}」</p><details class="parallel-story"><summary>读这条规则回响</summary>${item.narrative.map(p => `<p>${esc(p)}</p>`).join('')}</details></article>`;
  return `<p class="parallel-comparison" data-outcome-changed="${data.changed}"><strong>${data.changed ? '走向改变' : '走向不变'}</strong> · ${changedText ? '文字有修改；同走向不等于文字或维度完全相同。' : '两稿文字相同；以下仍列出实际规则结果。'}</p>
    <h3>两稿实际修改片段</h3><p class="muted">原稿删除处带删除线；改稿新增处带下划线，其余为未改文字。${changedText ? '' : '本次没有文字改动。'}</p>
    <div class="parallel-drafts">${draft('original','原稿 · 已寄出，只读')}${draft('alternate','改稿 · 未寄出')}</div>
    <div class="parallel-outcomes">${outcome(data.original,'已寄出的回信')}${outcome(data.alternate,'未寄出的另一版')}</div>
    <p class="parallel-evidence-comparison muted">${esc(evidenceComparison(data.original.evidence, data.alternate.evidence))}</p>
    <h3 class="parallel-delta-title">另一版相对原稿 · 五维变化与不变</h3><div class="parallel-deltas">${Object.entries(dims).map(([key,label]) => `<div data-dimension="${key}" data-delta="${data.delta[key]}" class="${data.delta[key] < 0 ? 'negative' : data.delta[key] > 0 ? 'positive' : ''}"><span>${label}</span><small>${data.original.scores[key]} → ${data.alternate.scores[key]}</small><b>${data.delta[key] === 0 ? '不变' : `${data.delta[key] > 0 ? '+' : ''}${data.delta[key]}`}</b></div>`).join('')}</div>
    <p class="parallel-explanation muted">以上是规则分数汇总，不是模型因果解释，也不能把某个增删片段当作某一分的原因。当前规则未提供逐句依据；未命中也不代表表达必然安全或事实已经核实。</p>
    <details class="parallel-rules"><summary>查看两稿规则记录（不是逐句评分原因）</summary><div class="parallel-rule-columns"><section><h4>原稿规则记录</h4>${rulesMarkup(data.original)}</section><section><h4>改稿规则记录</h4>${rulesMarkup(data.alternate)}</section></div></details>
    <p class="muted">${esc(data.boundary)}</p>`;
}

export function mountRehearsal(host, sid, originalText) {
  if (!host) return;
  const mount = {}; mounts.set(host, mount);
  host.innerHTML = `<section class="parallel panel"><div class="eyebrow">AFTER THE LETTER · 平行试写</div><h2>我的这次关键选择</h2><div class="parallel-original"><details><summary>回看我已寄出的回信（只读）</summary><p class="parallel-diff-text">${esc(originalText)}</p></details></div><p class="muted">如果那句话，换一种说法。<strong>只改回信，不改已知事实，不消耗邮票，也不覆盖正式档案。</strong></p><div class="parallel-entry-actions"><button type="button" class="btn parallel-open">如果只换一种说法 →</button></div><details class="parallel-editor"><summary class="btn ghost">打开另一张信纸 →</summary><form class="parallel-form"><label for="parallel-reply">另一版回信 · 10–2000 字</label><textarea id="parallel-reply" name="reply" minlength="10" maxlength="2000" required>${esc(originalText)}</textarea><div class="parallel-actions"><button type="submit" class="btn">试演这封回信</button><span>规则引擎模拟 · 不调用模型 · 不消耗邮票</span></div></form><p class="parallel-status" role="status" aria-live="polite"></p><div class="parallel-result"></div></details></section>`;
  const form = host.querySelector('form'), status = host.querySelector('.parallel-status'), result = host.querySelector('.parallel-result');
  const reply = form.elements.reply, button = form.querySelector('button');
  let busy = false, revision = 0;
  const active = () => host.isConnected && mounts.get(host) === mount;
  host.querySelector('.parallel-open').onclick = () => { host.querySelector('.parallel-editor').open = true; reply.focus(); };
  reply.oninput = () => {
    revision++; result.innerHTML = '';
    status.textContent = '回信已修改，尚未更新对照，请重新试演。';
  };
  form.onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    busy = true; button.disabled = true; result.innerHTML = '';
    const text = reply.value, requestedRevision = revision;
    status.textContent = '保留同一份线索，试演另一种回答…';
    const current = () => active() && requestedRevision === revision && reply.value === text;
    try {
      const res = await fetch(`/api/session/${encodeURIComponent(sid)}/rehearsal`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
      const data = await res.json();
      if (!current()) return;
      if (!res.ok) throw Error(data.error || '试写暂不可用');
      const markup = rehearsalResultMarkup(data);
      if (data.alternate.text !== text.trim() || data.original.text !== String(originalText).trim()) throw Error('试写回信与当前稿不一致');
      result.innerHTML = markup;
      status.textContent = data.changed ? '对照已更新：同样的已知事实，回信走向发生了变化。' : '对照已更新：走向不变，请看文字和维度各自的变化与不变。';
      button.textContent = '再次试演这封回信';
    } catch (e) {
      if (current()) { result.innerHTML = ''; status.textContent = `${e.message || '试写失败'}。对照未更新，请重试；正式档案与邮票未改变。`; button.textContent = '重试这封回信'; }
    } finally {
      busy = false;
      if (active()) button.disabled = false;
    }
  };
}
