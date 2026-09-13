import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../lib/engine.mjs';
const sorted=(id='leaving')=>{const s=E.createSession(id,'repair-test');E.applySorting(s,Object.fromEntries(E.LETTERS[id].body.map(b=>[b.id,b.type])));return s;};
test('逐处区分否定、反对引用与直述伤害，不让一个否定掩盖后续辱骂',()=>{
 for(const q of ['叔叔，阿澈不是废物，也不是没出息，您愿意说说最担心什么吗？','请别说他是废物，能聊聊吗？','“你是废物”这种说法不对，请不要这样说。'])assert.notEqual(E.classifyAttitude(q),'hostile',q);
 for(const q of ['你就是废物','你不是废物，但你爸是废物','你不是废物\n你爸是废物','你不是一般的废物','难道你不是废物吗？','我没有说你不是废物','“你是废物”，我赞同','呵呵，你可真不是废物啊'])assert.equal(E.classifyAttitude(q),'hostile',q);
});
test('劝阻极端行为不扣风险，真正建议与双重否定仍扣分，摘句标签一致',()=>{
 const l=E.LETTERS.leaving,s=sorted();
 const safe='南，我理解你的难处。不要因为一时冲动就断绝关系，也不要拉黑妈妈，更不能说她不爱你。今晚先和妈妈谈一次，再商量杭州的安排。';
 assert.equal(E.scoreReply(l,s,safe).scores.safety,90);
 for(const text of ['断绝关系，拉黑妈妈，她不爱你','不要不拉黑妈妈，她不爱你','别犹豫，拉黑妈妈','不要难受了，拉黑妈妈'])assert.ok(E.scoreReply(l,s,text).scores.safety<90,text);
 assert.equal(E.extractQuote(safe,l).risky,false);
});
test('引擎拒绝缺句、多句、非法分类和错误阶段，失败不修改状态',()=>{
 const complete=Object.fromEntries(E.LETTERS.leaving.body.map(b=>[b.id,'fact']));
 for(const map of [{}, {s1:'fact'}, {...complete,extra:'fact'}, {...complete,s1:['fact']}, Object.values(complete), Object.fromEntries(E.LETTERS.leaving.body.map(b=>[b.id,'invalid']))]){const s=E.createSession('leaving','invalid'),before=structuredClone(s);assert.throws(()=>E.applySorting(s,map));assert.deepEqual(s,before);}
 const s=E.createSession('leaving','early');assert.throws(()=>E.enterWrite(s));assert.equal(s.phase,'sort');
});
test('结局标签不硬编码女性称谓',()=>{for(const text of Object.values(E.FAMILY_LABEL))assert.ok(!/[她他]/.test(text));});
