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
