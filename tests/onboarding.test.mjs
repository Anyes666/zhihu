import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreGuide, guideStep, reflectionMarkup } from '../public/onboarding.js';

test('新手默认邀请，跳过和完成状态恢复；损坏/旧版存储安全重置', () => {
  assert.equal(restoreGuide(null).status, 'new');
  for (const status of ['active', 'skipped', 'complete']) assert.equal(restoreGuide(JSON.stringify({version:1,status,seen:['read'],sid:'abc'})).status,status);
  for (const raw of ['{', '{"version":0,"status":"complete"}', '{"version":1,"status":"oops"}']) assert.equal(restoreGuide(raw).status,'new');
});
test('按真实阶段推进，失败/忙碌不把渲染当成功；自由路线不用标准答案', () => {
  const state={status:'active',seen:[]};
  assert.equal(guideStep({view:'sort',assigned:0},state).id,'sort-pick');
  assert.equal(guideStep({view:'sort',assigned:0,selected:'s7'},state).id,'sort-place');
  assert.equal(guideStep({view:'sort',assigned:9,total:9},state).id,'sort-seal');
  assert.equal(guideStep({view:'sort',sortDone:true},state).id,'sort-done');
  assert.equal(guideStep({view:'talk',summoned:0},state).id,'cast');
  assert.equal(guideStep({view:'talk',summoned:1,talks:0,stamps:3},state).id,'ask');
  assert.equal(guideStep({view:'talk',summoned:1,talks:0,busy:true},state),null);
  assert.equal(guideStep({view:'talk',summoned:1,talks:1},state).id,'listen');
  assert.equal(guideStep({view:'write'},state).id,'write');
  assert.equal(guideStep({view:'write',reviewReady:true},state).id,'review');
  assert.equal(guideStep({view:'echo',endingReady:false},state),null);
  assert.equal(guideStep({view:'echo',endingReady:true},state).id,'ending');
});
test('知乎可选，邮票耗尽也能继续；跳过不产生步骤', () => {
  const state={status:'active',seen:['listen']};
  assert.equal(guideStep({view:'talk',summoned:1,talks:0,stamps:0},state).id,'research');
  assert.equal(guideStep({view:'talk',summoned:1,talks:2,researchOpen:true},state).id,'sources');
  assert.equal(guideStep({view:'talk',summoned:1,talks:2}, {...state,seen:['listen','research']}).id,'to-write');
  assert.equal(guideStep({view:'home'},{status:'skipped',seen:[]}),null);
});
test('回顾只使用本局事实、转义用户内容，风险句不当金句；不虚构未提问经历', () => {
  const session={talks:[{q:'<img src=x onerror=alert(1)>',name:'南的母亲'}],truthsUnlocked:[{title:'未说出的担心'}]};
  const ending={quote:'你活该<script>',quoteRisky:true,missed:[{title:'第二层'}]};
  const html=reflectionMarkup(session,ending);
  assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('需要重新掂量'));
  assert.ok(html.includes('第二层')); assert.ok(html.includes('未说出的担心'));
  assert.ok(reflectionMarkup({talks:[],truthsUnlocked:[]},{missed:[]}).includes('没有向角色追问'));
});


test('引导先看介绍，再选信；介绍已读和中途恢复不重复打断', () => {
  const state = { status: 'active', seen: [] };
  assert.equal(guideStep({ view: 'home' }, state).id, 'introduction');
  assert.equal(guideStep({ view: 'home' }, state).target, '#game-intro-content');
  assert.equal(guideStep({ view: 'home' }, { ...state, seen: ['introduction'] }).id, 'home');
  assert.equal(guideStep({ view: 'talk', summoned: 0 }, state).id, 'cast');
});
