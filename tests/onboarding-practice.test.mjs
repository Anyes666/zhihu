import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as onboarding from '../public/onboarding.js';

const { restoreGuide, guideStep } = onboarding;
const source = readFileSync(new URL('../public/onboarding.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/onboarding.css', import.meta.url), 'utf8');

test('v1 元数据迁移保留退出选择、seen 和 sid，不要求旧玩家补练习', () => {
  for (const status of ['active', 'skipped', 'complete']) {
    const state = restoreGuide(JSON.stringify({ version: 1, status, seen: ['read', 'write'], sid: 'existing' }));
    assert.deepEqual(state, { version: 2, status, seen: ['read', 'write'], sid: 'existing', practice: 'skipped' });
  }
  assert.equal(restoreGuide(JSON.stringify({version: 1, status: 'new'})).practice, 'pending');
});

test('v2 只恢复引导元信息；不接收游戏、草稿或练习文字', () => {
  for (const practice of ['pending', 'complete', 'skipped']) {
    const state = restoreGuide(JSON.stringify({version: 2, status: 'active', seen: ['read', 9], sid: 'saved', practice, draft: 'private', resources: {stamps: 2}}));
    assert.deepEqual(state, {version: 2, status: 'active', seen: ['read'], sid: 'saved', practice});
  }
  assert.equal(restoreGuide('{').practice, 'pending');
  assert.equal(restoreGuide(JSON.stringify({version: 2, status: 'active', practice: 'bad'})).practice, 'skipped');
});

test('新邀请仅摘要和底部位置，确认后进入独立练习；旧中途路线不受影响', () => {
  const state = restoreGuide(null);
  const welcome = guideStep({view: 'home'}, state);
  assert.match(welcome.text, /底部.*游戏介绍/);
  assert.equal(guideStep({view: 'home'}, {...state, status: 'active'}).id, 'practice');
  assert.equal(guideStep({view: 'sort', assigned: 0}, {...state, status: 'active', practice: 'skipped'}).id, 'sort-pick');
  assert.equal(guideStep({view: 'sort', assigned: 0}, {...state, status: 'skipped'}), null);
});

test('每个引导步骤有当前目标、具体动作和完成变化，旧 step 字段保留', () => {
  const state = {status: 'active', seen: [], practice: 'skipped'};
  const contexts = [
    {view:'home'}, {view:'home', seen:['introduction']}, {view:'read'}, {view:'read', seen:['read']},
    {view:'sort'}, {view:'sort', selected:'s1', selectedText:'完整句子'}, {view:'sort', assigned:9, total:9}, {view:'sort', sortDone:true},
    {view:'talk'}, {view:'talk',summoned:1,stamps:1}, {view:'talk',summoned:1,talks:1},
    {view:'talk',summoned:1,seen:['listen']}, {view:'talk',summoned:1,seen:['listen'],researchOpen:true},
    {view:'talk',summoned:1,seen:['listen','research']}, {view:'write'}, {view:'write',reviewReady:true},
    {view:'echo',endingReady:true}, {view:'echo',endingReady:true,seen:['ending']},
  ];
  for (const c of contexts) {
    const step = guideStep(c, {...state, seen:c.seen || []});
    for (const key of ['id','target','title','text','chapter','goal','instruction','outcome']) assert.ok(step[key], `${step.id}: ${key}`);
    assert.ok(Object.hasOwn(step, 'action'));
    if (step.id === 'sort-place') assert.equal(step.target, '#sort-selection');
  }
});

test('练习恰好两句原创事实/情绪，六类帮助解释和例子独立齐全', () => {
  assert.equal(onboarding.PRACTICE_SENTENCES?.length, 2);
  assert.deepEqual(onboarding.PRACTICE_SENTENCES.map(s => s.category), ['fact','emotion']);
  assert.deepEqual(onboarding.CATEGORY_HELP.map(c => c.id), ['fact','emotion','demand','bias','avoidance','clue']);
  for (const c of onboarding.CATEGORY_HELP) for (const key of ['label','explanation','example']) assert.ok(c[key]);
  const dir = new URL('../data/letters/', import.meta.url);
  const stories = readdirSync(dir).map(name => readFileSync(new URL(name, dir), 'utf8')).join('\n');
  for (const sentence of onboarding.PRACTICE_SENTENCES) assert.ok(!stories.includes(sentence.text));
});

test('先选句再选类：未选句和非法事件无效，初始分类禁用', () => {
  const state = onboarding.freshPractice();
  assert.deepEqual(state, {selected:null, completed:[], feedback:null});
  assert.equal(onboarding.practiceAction(state, {type:'classify',category:'fact'}), state);
  assert.equal(onboarding.practiceAction(state, {type:'select',id:'formal-s1'}), state);
  assert.match(onboarding.practiceMarkup(state), /<fieldset[^>]*id="guide-practice-categories"[^>]*disabled/);
  assert.match(onboarding.practiceMarkup(state), /先点一句/);
});

test('错误立即给理由且保留选句，可原位重试；不修改输入状态', () => {
  const initial = onboarding.freshPractice();
  const selected = onboarding.practiceAction(initial, {type:'select', id:'practice-fact'});
  const wrong = onboarding.practiceAction(selected, {type:'classify', category:'emotion'});
  assert.deepEqual(initial, {selected:null, completed:[], feedback:null});
  assert.equal(selected.feedback, null);
  assert.equal(wrong.selected, 'practice-fact');
  assert.deepEqual(wrong.completed, []);
  assert.equal(wrong.feedback.correct, false);
  assert.match(wrong.feedback.message, /核对|核实/);
  assert.match(onboarding.practiceMarkup(wrong), /role="status"/);
  assert.match(onboarding.practiceMarkup(wrong), /再选|重试/);
  assert.equal(onboarding.practiceAction(wrong, {type:'classify',category:'clue'}), wrong);
  const right = onboarding.practiceAction(wrong, {type:'classify', category:'fact'});
  assert.deepEqual(right.completed, ['practice-fact']);
  assert.equal(right.feedback.correct, true);
  assert.equal(right.selected, null);
});

test('第二句可先做；正确后不能重复累计；完成与重玩仅改变练习状态', () => {
  let state = onboarding.freshPractice();
  for (const [id, category] of [['practice-emotion','emotion'], ['practice-fact','fact']]) {
    state = onboarding.practiceAction(state, {type:'select', id});
    if (category === 'emotion') {
      state = onboarding.practiceAction(state, {type:'classify',category:'fact'});
      assert.match(state.feedback.message, /感受/);
      assert.equal(state.feedback.correct, false);
    }
    state = onboarding.practiceAction(state, {type:'classify',category});
    assert.equal(onboarding.practiceAction(state, {type:'select',id}), state);
  }
  assert.equal(state.completed.length, 2);
  assert.match(onboarding.practiceMarkup(state), /2\s*\/\s*2/);
  assert.deepEqual(onboarding.practiceAction(state, {type:'restart'}), onboarding.freshPractice());
  assert.equal(state.completed.length, 2);
});

test('完整选句可见且内容转义；练习选择器不与正式 .frag / data-choice 冲突', () => {
  const state = onboarding.practiceAction(onboarding.freshPractice(), {type:'select', id:'practice-emotion'});
  const html = onboarding.practiceMarkup({...state, feedback:{correct:false,message:'<script>oops</script>'}});
  assert.ok(html.includes(onboarding.PRACTICE_SENTENCES[1].text));
  assert.match(html, /id="guide-practice-selected"/);
  assert.match(html, /data-practice-sentence="practice-emotion"[^>]*aria-pressed="true"/);
  assert.match(html, /data-practice-category="emotion"/);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('data-choice=') && !html.includes('class="frag'));
});

test('模块无网络、游戏资源写入、自动展开介绍或强制滚动，只有引导存储键', () => {
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage\.(?:clear|removeItem)\s*\(/);
  assert.doesNotMatch(source, /\bimport\s.*from\s/);
  assert.equal([...source.matchAll(/localStorage\.setItem\(/g)].length, 1);
  assert.match(source, /const KEY = 'echo\.guide\.v1'/);
  assert.doesNotMatch(source, /intro\.open\s*=|scrollBy\(|scrollIntoView\(|#guide-title'\)\.focus/);
});

test('提示卡及帮助入口在普通文档流，不以底部遮挡或蒙层阻碍桌面/320/390点击', () => {
  const cardRule = css.match(/\.guide-card\{([^}]+)\}/)?.[1] || '';
  const helpRule = css.match(/\.guide-help\{([^}]+)\}/)?.[1] || '';
  assert.doesNotMatch(cardRule + helpRule, /position:fixed|position:sticky/);
  assert.doesNotMatch(css, /9999px|body\.guide-visible\{padding-bottom/);
  assert.match(source, /insertBefore\(root,\s*app\)/);
  assert.match(source, /id="guide-practice-replay"/);
  assert.match(source, /id="guide-practice-skip"/);
  assert.match(source, /guide:visibility/);
});


test('中文源码完整保留，不接受管道编码产生的连续字面问号', () => {
  assert.doesNotMatch(source, /\?{3,}/);
  assert.equal(onboarding.PRACTICE_SENTENCES[0].text, '今天下午，我把两本借来的图册放回了书架。');
  assert.equal(onboarding.CATEGORY_HELP[1].label, '情绪');
});

// DOM 边界替身：业务状态与本地存储是真实对象，事件调用真实 mountGuide。
// 实际布局/触摸命中由主代理的浏览器脚本验证，不把替身当成浏览器渲染。
function mountFixture(t, stored = null) {
  const nodes = new Map(), listeners = new Map(), writes = [], moves = [];
  let active = null, root;
  const make = name => {
    const attributes = new Map(), classes = new Set();
    const node = { name, hidden:false, disabled:false, dataset:{}, style:{}, textContent:'', parentNode:null,
      classList:{toggle(key, value) { if (value) classes.add(key); else classes.delete(key); }, contains(key) { return classes.has(key); }},
      setAttribute(key, value) { attributes.set(key, value); }, getAttribute(key) { return attributes.get(key); },
      focus() { active = node; }, contains(other) {
        if (node === other) return true;
        if (node === root) return [...nodes.entries()].some(([key, value]) => value === other && (key.startsWith('#guide-') || key.startsWith('[data-practice-') || key.startsWith('.guide-')));
        if (name === '.guide-card') return !!other && (other.name.startsWith('#guide-') && !['#guide-help','#guide-practice-replay'].includes(other.name) || other.name.startsWith('[data-practice-'));
        return false;
      },
      getClientRects() { return node.hidden ? [] : [{}]; },
      getBoundingClientRect() { return {top:100,bottom:180,left:20,right:280}; },
      querySelector(selector) { return nodes.get(selector) || null; },
      closest(selector) { return name.startsWith(selector.slice(0,-1) + '=') ? node : null; },
      appendChild(child) { child.parentNode = node; moves.push([child, node]); },
      insertBefore(child, before) { child.parentNode = node; child.nextSibling = before; moves.push([child, node]); },
    };
    nodes.set(name, node); return node;
  };
  for (const name of ['.guide-card','.guide-ring','.guide-tools','.practice-progress','#guide-title','#guide-chapter','#guide-text','#guide-note','#guide-storage','#guide-next','#guide-skip','#guide-collapse','#guide-help','#guide-announcement','#guide-practice','#guide-practice-replay','#guide-practice-skip','#guide-practice-selected','#guide-practice-categories','#guide-practice-feedback','#app','#trays','#sort-selection','#reply','#game-intro']) make(name);
  for (const id of ['practice-fact','practice-emotion']) {
    const node = make(`[data-practice-sentence="${id}"]`); node.dataset.practiceSentence = id;
  }
  for (const category of ['fact','emotion']) {
    const node = make(`[data-practice-category="${category}"]`); node.dataset.practiceCategory = category;
  }
  const body = make('body'); body.appendChild(nodes.get('#app')); nodes.get('#app').appendChild(nodes.get('#trays')); nodes.get('#app').appendChild(nodes.get('#reply'));
  const storage = new Map([['echo.guide.v1', stored], ['echo.game', '{"id":"safe","stamps":3}'], ['echo.draft.saved','正在写的私人草稿']]);
  const globals = {
    document:{body, get activeElement() {return active;}, createElement() { root = make('root'); return root; }, querySelector:selector => nodes.get(selector) || null,
      addEventListener(name, fn) { listeners.set(name, fn); }, dispatchEvent(event) { listeners.get(event.type)?.(event); }},
    window:{innerWidth:390,innerHeight:844,addEventListener() {}},
    localStorage:{getItem:key => storage.get(key), setItem(key, value) { writes.push(key); storage.set(key, value); }},
    CustomEvent:class {constructor(type, options) {this.type=type;this.detail=options.detail;}},
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {configurable:true, value});
    t.after(() => {if (descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key];});
  }
  const guide = onboarding.mountGuide();
  const click = selector => {
    const node = nodes.get(selector); node.focus();
    if (selector.startsWith('[data-practice-')) nodes.get('#guide-practice').onclick({target:node});
    else node.onclick();
  };
  return { guide, nodes, storage, writes, moves, root, click, listeners, focused:() => active,
    metadata:() => JSON.parse(storage.get('echo.guide.v1')) };
}

test('挂载真实控制器：练习错误重试/完成/重玩/跳过不修改游戏草稿，只持久化元信息', t => {
  const f = mountFixture(t);
  f.guide.sync({view:'home'});
  f.click('#guide-next');
  assert.equal(f.nodes.get('.guide-card').dataset.step, 'practice');
  f.click('[data-practice-sentence="practice-fact"]');
  f.click('[data-practice-category="emotion"]');
  assert.equal(f.nodes.get('#guide-practice-feedback').dataset.result, 'incorrect');
  assert.equal(f.focused().dataset.practiceCategory, 'emotion');
  f.click('[data-practice-category="fact"]');
  f.click('[data-practice-sentence="practice-emotion"]');
  f.click('[data-practice-category="emotion"]');
  assert.equal(f.nodes.get('#guide-next').hidden, false);
  f.click('#guide-next');
  assert.equal(f.nodes.get('.guide-card').dataset.step, 'home');
  assert.equal(f.metadata().practice, 'complete');
  f.click('#guide-practice-replay'); f.click('#guide-practice-skip');
  assert.equal(f.metadata().practice, 'skipped');
  f.click('#guide-skip'); f.click('#guide-help');
  assert.equal(f.nodes.get('.guide-card').dataset.step, 'home');
  assert.equal(f.storage.get('echo.game'), '{"id":"safe","stamps":3}');
  assert.equal(f.storage.get('echo.draft.saved'), '正在写的私人草稿');
  assert.ok(f.writes.every(key => key === 'echo.guide.v1'));
  assert.equal(f.nodes.get('#game-intro').open, undefined);
});

test('提示就近挂在稳定分类容器，反复选句/分类不移动节点或抢业务焦点；suspend先撤出app', t => {
  const f = mountFixture(t, JSON.stringify({version:1,status:'active',seen:['read'],sid:'saved'}));
  const context = {view:'sort', sid:'saved', assigned:0};
  f.guide.sync(context);
  assert.equal(f.root.parentNode, f.nodes.get('#trays'));
  const moveCount = f.moves.length;
  f.nodes.get('#reply').focus();
  f.guide.sync({...context, selected:'s1', selectedText:'句子一'});
  f.guide.sync({...context, assigned:1});
  f.guide.sync({...context, selected:'s2', selectedText:'句子二'});
  assert.equal(f.moves.length, moveCount);
  assert.equal(f.focused(), f.nodes.get('#reply'));
  f.guide.suspend();
  assert.equal(f.root.parentNode, f.nodes.get('#app').parentNode);
  assert.equal(f.root.nextSibling, f.nodes.get('#app'));
});

test('重新打开写作提示不抹草稿；重复sync不会抢焦点；鉴权弹窗时隐藏提示及帮助', t => {
  const f = mountFixture(t, JSON.stringify({version:1,status:'active',seen:['write'],sid:'saved'}));
  f.guide.sync({view:'write',sid:'saved'});
  assert.equal(f.nodes.get('.guide-card').hidden, true);
  f.click('#guide-help');
  assert.equal(f.nodes.get('.guide-card').hidden, false);
  f.nodes.get('#reply').focus();
  f.guide.sync({view:'write',sid:'saved'});
  assert.equal(f.focused(), f.nodes.get('#reply'));
  f.nodes.set('#zhihu-dialog', {open:true}); f.listeners.get('echo:auth-modal')();
  assert.equal(f.nodes.get('.guide-card').hidden, true);
  assert.equal(f.nodes.get('.guide-tools').hidden, true);
  assert.equal(f.storage.get('echo.draft.saved'), '正在写的私人草稿');
});

test('独立重玩保留已跳过/已完成引导的选择，退出练习不强制重开正式引导', t => {
  const f = mountFixture(t, JSON.stringify({version:2,status:'complete',seen:['read','write','ending'],sid:'saved',practice:'complete'}));
  f.guide.sync({view:'write',sid:'saved'});
  f.click('#guide-practice-replay');
  assert.equal(f.nodes.get('.guide-card').dataset.step, 'practice');
  assert.equal(f.metadata().status, 'complete');
  f.click('#guide-practice-skip');
  assert.equal(f.metadata().status, 'complete');
  assert.deepEqual(f.metadata().seen.filter(id => id !== 'introduction'), ['read','write','ending']);
  assert.equal(f.nodes.get('.guide-card').hidden, true);
});
