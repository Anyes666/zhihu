import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBudget } from "../lib/budget.mjs";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=async()=>{const s=http.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const map={s1:'fact',s2:'fact',s3:'clue',s4:'emotion',s5:'bias',s6:'demand',s7:'avoidance',s8:'fact',s9:'emotion'};
const parse=text=>{const r={};for(const m of text.matchAll(/event: (\w+)\ndata: (.*)/g))r[m[1]]=JSON.parse(m[2]);return r;};

test("真实服务层预算：重复请求、并发、跨局、跨重启、熔断仍通关", async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'echo-budget-http-'));
 let child,calls=0,requests=[];let mode='ok';
 const mock=http.createServer(async(req,res)=>{
  let text='';for await(const c of req)text+=c;requests.push(JSON.parse(text));calls++;
  if(mode==='slow')await sleep(250);
  if(mode==='fail'){res.writeHead(502);return res.end('{}');}
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.end(`data: ${JSON.stringify({choices:[{delta:{content:'这是本地 mock 表达，并非远程模型。我们可以先把已知事实与自己的猜测分开，问清楚她真正的顾虑。'}}]})}\n\ndata: [DONE]\n\n`);
 });
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const port=await freePort(),base=`http://127.0.0.1:${port}`,dbPath=path.join(dir,'budget.sqlite');let cookie='';
 const env={...process.env,PORT:String(port),HOST:'127.0.0.1',LLM_PROVIDER:'deepseek',LLM_BASE_URL:`http://127.0.0.1:${mock.address().port}`,LLM_API_KEY:'local-only',LLM_MODEL:'deepseek-flash',
   ZHIHU_ACCESS_SECRET:'',ZHIHU_KNOWLEDGE_ENABLED:'false',ZHIHU_CACHE_DIR:path.join(dir,'cache'),API_BUDGET_DB:dbPath,API_LIVE_ENABLED:'true',
   API_LLM_DAILY_CALLS:'3',API_LLM_TOTAL_CALLS:'3',API_LLM_DAILY_UNITS:'100000',API_LLM_TOTAL_UNITS:'100000',API_LLM_PLAYER_DAILY_CALLS:'10',API_LLM_IP_DAILY_CALLS:'10',API_PLAYER_PER_MINUTE:'100',API_IP_PER_MINUTE:'100',
   ZHIHU_OAUTH_APP_ID:'',ZHIHU_OAUTH_APP_KEY:'',ZHIHU_OAUTH_REDIRECT_URI:''};
 const start=async()=>{child=spawn(process.execPath,['server.mjs'],{cwd:process.cwd(),env,stdio:'ignore',windowsHide:true});for(let i=0;i<60;i++){try{const r=await fetch(base+'/api/health');if(r.ok)return;}catch{}await sleep(50);}throw Error('server startup timeout');};
 const stop=async()=>{if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}child=null;};
 const req=async(p,body,extra={})=>{const r=await fetch(base+p,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const text=await r.text();let json;try{json=JSON.parse(text);}catch{}return{status:r.status,json,text,events:parse(text)};};
 const setup=async()=>{const r=await req('/api/session',{letterId:'leaving'}),root='/api/session/'+r.json.session.id;await req(root+'/sort',{assignments:map});await req(root+'/summon',{charId:'silent'});return root;};
 try {
  await start();let root;
  await t.test('单次参数有输出封顶，重复提问重放而非消耗新资源',async()=>{
   root=await setup();const payload={charId:'silent',question:'阿姨，租房页面是误点的吗？'};
   const first=await req(root+'/ask',payload);assert.equal(first.events.done.generated,true);assert.equal(calls,1);
   assert.equal(requests[0].max_tokens,800);assert.deepEqual(requests[0].thinking,{type:'disabled'});
   const again=await req(root+'/ask',payload);assert.equal(again.events.done.replayed,true);assert.equal(calls,1);
   assert.equal(again.events.done.session.resources.stamps,first.events.done.session.resources.stamps);
  });
  await t.test('同一局并行提问只放行一次；异步处理中不重复扣票',async()=>{
   mode='slow';const payload={charId:'silent',question:'您最怕的是什么？'};
   const rs=await Promise.all([req(root+'/ask',payload),req(root+'/ask',payload)]);
   assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);assert.equal(calls,2);mode='ok';
  });
  await t.test('失败请求计入预算；跨局共享玩家与全站上限',async()=>{
   const other=await setup();mode='fail';const r=await req(other+'/ask',{charId:'silent',question:'您愿意聊一聊吗？'});
   assert.equal(r.events.done.generated,false);assert.equal(calls,3);mode='ok';
   const later=await req(other+'/ask',{charId:'silent',question:'您最近怎么样？'});
   assert.equal(later.events.done.generated,false);assert.equal(later.events.notice.code,'BUDGET_EXHAUSTED');assert.equal(calls,3);
  });
  await t.test('熔断后点评/结局正常完成，重复定稿不产生调用',async()=>{
   await req(root+'/write',{});const reply='南，我听见你的难过。先问问妈妈真正担心什么，再给HR回信确认offer是否还有效。你可以列一下杭州生活预算和回家探望的安排。';
   const reviewed=await req(root+'/reply',{text:reply});assert.equal(reviewed.events.done.generated,false);
   const replay=await req(root+'/reply',{text:reply});assert.equal(replay.events.done.replayed,true);
   const final=await req(root+'/finalize',{});assert.ok(final.events.ending);assert.equal(final.events.done.generated,false);
   const repeated=await req(root+'/finalize',{});assert.equal(repeated.events.done.replayed,true);assert.equal(calls,3);
   assert.equal((await req(root+'/state')).json.session.phase,'echo');
  });
  await t.test('服务重启后、换 Cookie 后仍不能绕过累计预算',async()=>{
   await stop();await start();cookie='';const next=await setup();
   const denied=await req(next+'/ask',{charId:'silent',question:'您最近怎么样？'});
   assert.equal(denied.events.notice.code,'BUDGET_EXHAUSTED');assert.equal(calls,3);
   const health=await req('/api/health');assert.equal(health.json.budget.mode,'classic');
   assert.ok(!JSON.stringify(health.json.budget).includes('totalCalls'));
   const ledger=createBudget({env,dbPath});assert.equal(ledger.snapshot().usage.find(x=>x.kind==='llm').totalCalls,3);ledger.close();
  });
  await t.test('跨站消耗请求拒绝；伪造回调不触发上游',async()=>{
   assert.equal((await req('/api/session',{letterId:'leaving'},{origin:'https://other.example'})).status,403);
   assert.equal((await req('/api/auth/zhihu/callback?authorization_code=fake')).status,404);assert.equal(calls,3);
  });
 } finally {await stop();mock.closeAllConnections();await new Promise(r=>mock.close(r));await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
