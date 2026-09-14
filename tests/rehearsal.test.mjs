import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../lib/engine.mjs';
import { rehearseReply } from '../lib/rehearsal.mjs';
const original = '南，你已经很不容易了。先说结论：先和妈妈坐下来谈一次。那个租房页面不是误点，她怕成为你的负担。今晚先回复HR，确认offer是否还有效，再一起列出杭州的生活预算。';
const harmful = '你就是自私，必须马上离开！不要再跟妈妈联系，直接断绝关系。她只会拖累你，你根本不用管她，以后永远不要回家。';
function finished() { const s=E.createSession('leaving','rehearsal-test'); E.applySorting(s,Object.fromEntries(E.LETTERS.leaving.body.map(b=>[b.id,"fact"]))); E.summon(s,'silent'); E.ask(s,'silent','阿姨，那个租房页面，您最怕的是什么？'); E.enterWrite(s); E.submitReply(s,original); E.finalize(s); return s; }
test('平行试写仅在结局后开放，不能用于提前窥探结局',()=>{const s=finished();for(const phase of ['read','sort','talk','write','review','revise']){s.phase=phase;assert.throws(()=>rehearseReply(s,harmful),/回响/);}});
test('平行试写不修改正式回信、资源、真相、来源笔记或时间线',()=>{const s=finished();s.research={notes:[{reflection:'不能把相似经历直接套用到当事人身上。'}]};const before=structuredClone(s);const r=rehearseReply(s,harmful);assert.deepEqual(s,before);assert.equal(r.simulation,true);assert.equal(r.generated,false);assert.equal(r.alternate.family,'backfire');assert.ok(r.delta.safety<0);assert.equal(r.alternate.depth,r.original.depth);assert.equal(r.alternate.quoteRisky,true);assert.equal(r.alternate.narrative.length,2);});
test('相同回信试写结果不变，重复试写可复现且不随机刷赞',()=>{const s=finished();const a=rehearseReply(s,original),b=rehearseReply(s,original);assert.deepEqual(a,b);for(const value of Object.values(a.delta))assert.equal(value,0);assert.equal(a.changed,false);assert.ok(!('community' in a.alternate));});
test('试写沿用长度校验，拒绝非文本输入',()=>{const s=finished();for(const text of ['', '短', '字'.repeat(2001),{},null])assert.throws(()=>rehearseReply(s,text));});

// P2-1: text comparison and browser-state regressions (no DOM dependency / network).
import * as rehearsal from '../lib/rehearsal.mjs';
import * as ui from '../public/rehearsal.js';

test('文字 diff 保留多个实际修改、相同片段、换行和完整 Unicode，不用结局摘句冒充改动', () => {
  const a = '先听你说。\n今晚一起谈🙂，再列预算。', b = '先听她说。\n明晚一起谈🙂，再列预算。';
  const parts = rehearsal.diffReplyText(a, b);
  assert.equal(parts.filter(p => p.type !== 'added').map(p => p.text).join(''), a);
  assert.equal(parts.filter(p => p.type !== 'removed').map(p => p.text).join(''), b);
  for (const [type, text] of [['removed','你'],['added','她'],['removed','今'],['added','明']]) {
    assert.ok(parts.some(p => p.type === type && p.text === text));
  }
  assert.deepEqual(rehearsal.diffReplyText(a, a), [{type:'unchanged',text:a}]);
  assert.deepEqual(rehearsal.diffReplyText('', '🙂'), [{type:'added',text:'🙂'}]);
  assert.deepEqual(rehearsal.diffReplyText('🙂', ''), [{type:'removed',text:'🙂'}]);
  const long = rehearsal.diffReplyText('甲'.repeat(2000), '乙'.repeat(2000));
  assert.deepEqual(long, [{type:'removed',text:'甲'.repeat(2000)},{type:'added',text:'乙'.repeat(2000)}]);
});

test('对照提供实际归一化回信文本、diff 和只读规则记录，不输出未确认真相的评分元数据', () => {
  const s = finished(), r = rehearseReply(s, '  ' + harmful + '  ');
  assert.equal(r.original.text, original);
  assert.equal(r.alternate.text, harmful);
  assert.deepEqual(r.textDiff, rehearsal.diffReplyText(original, harmful));
  assert.ok(r.alternate.ruleSummary.riskyHits.length > 0);
  assert.ok(!('truthMentions' in r.alternate.ruleSummary));
  assert.ok(!('meta' in r.alternate));
});

test('正式稿取已保存的规则结局和分数，试写不重新覆盖档案或资源', () => {
  const s = finished();
  s.endingResult = {...rehearseReply(s, original).original, family:'saved-family', familyLabel:'已存走向'};
  s.reply.scores.warmth = 17;
  const before = structuredClone(s), r = rehearseReply(s, harmful);
  assert.equal(r.original.family, 'saved-family');
  assert.equal(r.original.scores.warmth, 17);
  assert.equal(r.delta.warmth, r.alternate.scores.warmth - 17);
  assert.deepEqual(s, before);
  r.original.scores.warmth = 99;
  assert.deepEqual(s, before);
});

test('两稿同走向准确呈现，不假造不同结局或把规则记录说成模型因果', () => {
  const r = rehearseReply(finished(), original + '愿你安心。');
  assert.equal(r.changed, false);
  const html = ui.rehearsalResultMarkup(r);
  assert.match(html, /走向不变/);
  assert.match(html, /data-text-change="added"/);
  assert.match(html, /data-dimension="safety"[^>]*data-delta="0"/);
  assert.match(html, /不变/);
  assert.match(html, /当前规则未提供逐句依据/);
  assert.match(html, /不是模型因果解释/);
  assert.match(html, /规则记录/);
  assert.match(html, /90 → 90/);
});

test('所有服务端文本与 diff 均转义，不允许缺字段、坏分差或错配文本渲染成成功', () => {
  const r = rehearseReply(finished(), original + '<img src=x onerror=alert(1)>');
  r.alternate.familyLabel = '<script>alert(1)</script>';
  r.alternate.ruleSummary.riskyHits = ['<img onerror=alert(2)>'];
  const html = ui.rehearsalResultMarkup(r);
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;img/);
  for (const bad of [{}, {...r, delta:{}}, {...r,textDiff:[]}, {...r,changed:!r.changed}]) {
    assert.throws(() => ui.rehearsalResultMarkup(bad), /不完整|不一致/);
  }
});

function fakeHost(text = original, formalText = original) {
  const button = {disabled:false,textContent:''};
  const reply = {value:text, focus(){this.focused=true;}};
  const form = {elements:{reply},querySelector:()=>button};
  const status = {textContent:''}, result = {innerHTML:''}, editor = {open:false};
  const open = {}, next = {}, again = {click(){this.clicked=true;}};
  const elements = {'form':form,'.parallel-status':status,'.parallel-result':result,'.parallel-editor':editor,'.parallel-open':open,'.parallel-next':next};
  const host = {innerHTML:'',isConnected:true,querySelector:sel=>elements[sel],ownerDocument:{querySelector:()=>again}};
  ui.mountRehearsal(host, 'sid/x', formalText);
  return {host,form,status,result,button,reply,editor,open,next,again};
}
const submit = view => view.form.onsubmit({preventDefault(){}});

test('试写入口保留只换说法，下一封入口由 app 管理；正式稿只读且转义', () => {
  const view = fakeHost('</textarea><img onerror=x>', '</textarea><img onerror=x>');
  assert.match(view.host.innerHTML, /我的这次关键选择/);
  assert.match(view.host.innerHTML, /class="btn parallel-open"/);
  assert.ok(!view.host.innerHTML.includes('parallel-next'));
  assert.ok(!view.host.innerHTML.includes('再接一封信'));
  assert.ok(!view.host.innerHTML.includes('<img'));
  view.open.onclick(); assert.equal(view.editor.open, true); assert.equal(view.reply.focused, true);
  assert.equal(view.next.onclick, undefined);
});

test('成功后重试先清旧结果；失败可重试，不残留成功；重复提交只发一次', async t => {
  const r = rehearseReply(finished(), harmful), view = fakeHost(harmful);
  let calls = 0, resolve;
  t.mock.method(globalThis, 'fetch', async () => {calls++; return Response.json(r);});
  await submit(view); assert.match(view.result.innerHTML, /parallel-outcomes/);
  globalThis.fetch = async () => {calls++; return new Promise(done => {resolve=done;});};
  const pending = submit(view);
  assert.equal(view.result.innerHTML, ''); assert.equal(view.button.disabled, true);
  await submit(view); assert.equal(calls, 2);
  resolve(Response.json({error:'临时失败'},{status:503})); await pending;
  assert.equal(view.result.innerHTML, ''); assert.match(view.status.textContent, /临时失败.*重试/);
  assert.equal(view.button.disabled, false);
  globalThis.fetch = async () => Response.json(r);
  await submit(view); assert.match(view.result.innerHTML, /parallel-outcomes/);
});

test('输入改变及挂载切换丢弃在途回包，旧数据不得冒充当前稿成功', async t => {
  const r = rehearseReply(finished(), harmful), view = fakeHost(harmful);
  let resolve;
  t.mock.method(globalThis, 'fetch', () => new Promise(done => {resolve=done;}));
  const pending = submit(view);
  view.reply.value = original; view.reply.oninput();
  resolve(Response.json(r)); await pending;
  assert.equal(view.result.innerHTML, ''); assert.match(view.status.textContent, /尚未|重新试演/);
  assert.equal(view.button.disabled, false);
  const pendingAgain = submit(view);
  view.host.isConnected = false;
  resolve(Response.json(r)); await pendingAgain;
  assert.equal(view.result.innerHTML, '');
});

test('HTTP 成功但回包文本错配也视为失败，不显示旧稿成功', async t => {
  const view = fakeHost(original);
  t.mock.method(globalThis, 'fetch', async () => Response.json(rehearseReply(finished(), harmful)));
  await submit(view);
  assert.equal(view.result.innerHTML, ''); assert.match(view.status.textContent, /不一致.*重试/);
});

test('同一个 host 重挂载后旧请求不得写入新局状态', async t => {
  const view = fakeHost(harmful);
  let resolve;
  t.mock.method(globalThis, 'fetch', () => new Promise(done => {resolve=done;}));
  const pending = submit(view);
  ui.mountRehearsal(view.host, 'new-session', original);
  resolve(Response.json(rehearseReply(finished(), harmful))); await pending;
  assert.equal(view.result.innerHTML, '');
  assert.ok(!view.status.textContent.includes('对照已更新'));
});

test('成功之后继续编辑立即去掉旧成功结果；网络异常和非 JSON 失败都恢复重试', async t => {
  const view = fakeHost(harmful);
  t.mock.method(globalThis, 'fetch', async () => Response.json(rehearseReply(finished(), harmful)));
  await submit(view); assert.match(view.result.innerHTML, /parallel-outcomes/);
  view.reply.value += '再想想。'; view.reply.oninput();
  assert.equal(view.result.innerHTML, ''); assert.match(view.status.textContent, /尚未更新/);
  globalThis.fetch = async () => {throw Error('连接失败');};
  await submit(view); assert.equal(view.button.disabled, false); assert.match(view.status.textContent, /连接失败.*重试/);
  globalThis.fetch = async () => new Response('bad json', {status:502});
  await submit(view); assert.equal(view.button.disabled, false); assert.equal(view.result.innerHTML, ''); assert.match(view.status.textContent, /重试/);
});

test('三封信各自重复对照均不改正式会话，diff 完整还原且风险走向如实显示', () => {
  for (const id of Object.keys(E.LETTERS)) {
    const s = E.createSession(id, 'parallel-' + id);
    E.applySorting(s, Object.fromEntries(E.LETTERS[id].body.map(b => [b.id, 'fact'])));
    E.enterWrite(s); E.submitReply(s, original); s.endingResult = E.finalize(s);
    const before = structuredClone(s);
    const same = rehearseReply(s, original), risky = rehearseReply(s, harmful);
    assert.equal(same.changed, false);
    const expected = structuredClone(s); expected.phase = 'write';
    E.submitReply(expected, harmful); const ending = E.finalize(expected);
    assert.equal(risky.alternate.family, ending.family);
    assert.equal(risky.alternate.quoteRisky, ending.quoteRisky);
    assert.ok(ui.rehearsalResultMarkup(risky).includes(ending.familyLabel));
    assert.deepEqual(s, before);
    assert.deepEqual(rehearseReply(s, harmful), risky);
  }
});

test('旧规则深度标签不能代替 evidence 的已确认真相数量', () => {
  const r = rehearseReply(finished(), harmful);
  r.original.depthLabel = '你看见了信的全部';
  r.alternate.depthLabel = '你只看见了信的表面';
  const html = ui.rehearsalResultMarkup(r);
  assert.ok(!html.includes(r.original.depthLabel));
  assert.ok(!html.includes(r.alternate.depthLabel));
  assert.match(html, /同一份已知事实/);
});

const sampleEvidence = (score = 1.5, level = 'full') => ({
  confirmed: {count:1,total:2,label:'已确认真相 1/2'},
  coverage: {score,total:2,level,label:`回信依据覆盖：${{full:'充分',partial:'部分',blind:'有限'}[level]}`,confirmedMentioned:1}
});

test('正式档案 evidence 原样透传且深拷贝，不用当前 session 补算旧记录', () => {
  const s = finished();
  s.endingResult = {...rehearseReply(s, original).original, evidence:sampleEvidence()};
  const before = structuredClone(s), r = rehearseReply(s, harmful);
  assert.deepEqual(r.original.evidence, before.endingResult.evidence);
  r.original.evidence.confirmed.count = 0;
  assert.deepEqual(s, before);
});

test('旧档案或未保存结局缺 evidence 时明确未记录，不能从旧深度或当前会话补齐', () => {
  const s = finished();
  s.endingResult = {...rehearseReply(s, original).original}; delete s.endingResult.evidence;
  const before = structuredClone(s), r = rehearseReply(s, harmful);
  assert.equal(r.original.evidence, null);
  assert.deepEqual(s, before);
  const html = ui.rehearsalResultMarkup(r);
  assert.match(html, /data-evidence-status="unrecorded"/);
  assert.match(html, /未记录/);
  assert.match(html, /不推断/);
  s.endingResult = null;
  assert.equal(rehearseReply(s, harmful).original.evidence, null);
});

test('两稿统一 evidence 区分确认数量与规则覆盖，覆盖变化不冒充新增确认真相', () => {
  const r = rehearseReply(finished(), harmful);
  r.original.evidence = sampleEvidence(); r.alternate.evidence = sampleEvidence(.75, 'partial');
  const html = ui.rehearsalResultMarkup(r);
  assert.equal((html.match(/class="parallel-evidence"/g) || []).length, 2);
  assert.equal((html.match(/已确认真相 1\/2/g) || []).length, 2);
  assert.match(html, /回信依据覆盖：充分/); assert.match(html, /回信依据覆盖：部分/);
  assert.match(html, /data-coverage-level="full"/); assert.match(html, /data-coverage-level="partial"/);
  assert.match(html, /规则覆盖值 1.5\/2/); assert.match(html, /规则覆盖值 0.75\/2/);
  assert.match(html, /提及已确认真相 1 条/);
  assert.match(html, /已确认数量不变/);
  assert.match(html, /依据覆盖值 1.5 → 0.75/);
  assert.match(html, /不是已确认真相数量/);
  r.alternate.evidence = sampleEvidence();
  assert.match(ui.rehearsalResultMarkup(r), /依据覆盖不变/);
});

test('coverage 为 null 不编造零分或有限等级，旧稿缺字段时不编造分差', () => {
  const r = rehearseReply(finished(), harmful);
  r.original.evidence = null;
  r.alternate.evidence = {confirmed:sampleEvidence().confirmed,coverage:null};
  const html = ui.rehearsalResultMarkup(r);
  assert.match(html, /尚无回信依据覆盖记录/);
  assert.match(html, /无法比较依据覆盖/);
  assert.ok(!html.includes('规则覆盖值 0'));
  assert.ok(!html.includes('回信依据覆盖：有限'));
});

test('evidence 标签转义，非法结构和越界值拒绝作为成功展示', () => {
  const r = rehearseReply(finished(), harmful);
  r.original.evidence = sampleEvidence(); r.alternate.evidence = sampleEvidence(.25, 'blind');
  r.alternate.evidence.confirmed.label = '<img src=x onerror=alert(1)>';
  r.alternate.evidence.coverage.label = '<script>alert(2)</script>';
  const html = ui.rehearsalResultMarkup(r);
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;img/); assert.match(html, /&lt;script&gt;/);
  for (const bad of [{}, {...sampleEvidence(),confirmed:{count:3,total:2,label:'错误'}},
    {...sampleEvidence(),coverage:{...sampleEvidence().coverage,score:NaN}},
    {...sampleEvidence(),coverage:{...sampleEvidence().coverage,level:'<img>'}},
    {...sampleEvidence(),coverage:{...sampleEvidence().coverage,confirmedMentioned:2}}]) {
    r.alternate.evidence = bad;
    assert.throws(() => ui.rehearsalResultMarkup(r), /依据记录不完整/);
  }
});

test('接入 engine 的 evidenceView 与 finalize 实际契约，试写仍不改变已确认事实和正式会话', () => {
  assert.equal(typeof E.evidenceView, 'function');
  const s = finished();
  const snapshot = structuredClone(s); snapshot.phase = 'write'; E.submitReply(snapshot, original);
  s.endingResult = E.finalize(snapshot);
  const before = structuredClone(s), r = rehearseReply(s, harmful);
  const alternate = structuredClone(s); alternate.phase = 'write'; E.submitReply(alternate, harmful);
  const actualEnding = E.finalize(alternate);
  assert.deepEqual(r.original.evidence, s.endingResult.evidence);
  assert.deepEqual(r.alternate.evidence, actualEnding.evidence);
  assert.deepEqual(r.alternate.evidence, E.evidenceView(alternate));
  assert.deepEqual(r.original.evidence.confirmed, r.alternate.evidence.confirmed);
  assert.deepEqual(s, before);
  const html = ui.rehearsalResultMarkup(r);
  assert.ok(html.includes(r.original.evidence.coverage.label));
  assert.ok(html.includes(r.alternate.evidence.coverage.label));
});
