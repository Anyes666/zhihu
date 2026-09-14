import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionMarkup, clueModel, clueQuestion, writingMarkup, modeDescription } from '../public/investigation.js';

test('当前选句完整显示且六个分类可键盘点击，转义原句', () => {
  const sentence = '<script>一条很长的完整来信，不截断最后的字。</script>';
  const html = selectionMarkup(sentence);
  assert.ok(html.includes('不截断最后的字。&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.equal((html.match(/data-place=/g) || []).length, 6);
  assert.ok(html.includes('取消选中'));
});
test('线索板只使用服务端已公开事实、已确认真相和公开方向，不把参考笔记当事实', () => {
  const letter = { body: [{id:'s1',text:'我昨天收到一封邮件。'}, {id:'s2',text:'我犹豫了一整天。'}], truthCount:2 };
  const session = {mailFacts:[{id:'s1',text:letter.body[0].text,source:'来信第1句'}],truthsUnlocked:[{id:'t1',title:'已知',text:'已确认的一点',source:'角色对话'}],leads:[{segId:'s2',truthId:'t2',hint:'公开方向'}],research:{notes:[{text:'这不是本案事实'}]}};
  const before = structuredClone(session); const model = clueModel(letter, session);
  assert.equal(model.facts.length,1); assert.equal(model.confirmed.length,1); assert.equal(model.pending[0].text,letter.body[1].text);
  assert.ok(!JSON.stringify(model).includes('这不是本案事实')); assert.deepEqual(session,before);
  session.truthsUnlocked.push({id:'t2',text:'已经确认'}); assert.equal(clueModel(letter,session).pending.length,0);
});
test('围绕公开线索只给问题方向，长度有界，不泄漏不可见文字', () => {
  const q=clueQuestion('我昨天收到一封邮件。'); assert.ok(q.includes('我昨天收到一封邮件。')); assert.ok(q.endsWith('？'));
  assert.ok(clueQuestion('长'.repeat(1000)).length<=200); assert.equal(clueQuestion(''), '这件事还有哪些细节需要确认？');
});
test('写作扶手只给结构和边界，不存在自动填稿入口',()=>{
  const html=writingMarkup(); for(const word of ['事实','感受','下一步','至少 10 字','推荐 120–600 字'])assert.ok(html.includes(word));
  assert.ok(!html.includes('<textarea')); assert.ok(!html.includes('data-insert')); assert.ok(html.includes('<details'));
});
test('经典与已配置模型的模式说明不冒充实时成功',()=>{
  assert.match(modeDescription({llm:'none',budget:{mode:'classic'}}),/经典模式.*无需登录.*实时增强未开启/);
  assert.match(modeDescription({llm:'openai',budget:{mode:'classic'}}),/经典模式/);
  assert.match(modeDescription({llm:'openai',budget:{mode:'live'}}),/已配置.*每段来源标签/);
});
import { actionReceiptMarkup } from '../public/investigation.js';
test('行动回执展示真实前后数值与公开变化，未提供回执不造成功',()=>{
  assert.equal(actionReceiptMarkup(null),'');
  const receipt={type:'ask',char:'silent',stamps:{before:4,after:3,delta:-1},trust:{before:40,after:55,delta:15},attitude:{id:'gentle',label:'温和'},mood:{before:'guarded',after:'listening'},newTruths:[{title:'<已确认>',text:'公开内容'}],left:false,rules:['规则识别温和表达'],nextActions:[{id:'ask',label:'继续提问'},{id:'write',label:'带着线索落笔'}]};
  const html=actionReceiptMarkup(receipt);for(const v of ['4 → 3','40 → 55','+15','温和','有所戒备 → 认真倾听','&lt;已确认&gt;','规则识别温和表达'])assert.ok(html.includes(v),v);
  assert.ok(!html.includes('<已确认>'));assert.ok(html.includes('data-receipt-action="write"'));
  assert.match(actionReceiptMarkup(receipt,{replayed:true}),/重复请求.*未再次扣费/);
  assert.match(actionReceiptMarkup(receipt,{recovered:true}),/已核实服务端/);
});
