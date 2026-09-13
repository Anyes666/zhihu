import test from "node:test";
import assert from "node:assert/strict";
import { createBudget } from "../lib/budget.mjs";

test("默认不批准实时 API，不触发真实请求", () => {
  const budget = createBudget({ env: {}, dbPath: ":memory:" });
  assert.throws(() => budget.reserve("llm", { units: 100 }), { code: "BUDGET_DISABLED" });
  assert.equal(budget.status().mode, "classic");
  budget.close();
});

import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { runBudgetContext } from "../lib/budget.mjs";
const BASE = { API_LIVE_ENABLED: "true", API_LLM_DAILY_CALLS: "10", API_LLM_TOTAL_CALLS: "20", API_LLM_DAILY_UNITS: "10000", API_LLM_TOTAL_UNITS: "20000", API_PLAYER_PER_MINUTE: "100", API_IP_PER_MINUTE: "100" };
const actor = n => ({ player: "player" + n, ip: "ip" + n });
const fixture = env => createBudget({ env: { ...BASE, ...env }, dbPath: ":memory:" });

test("预留后立即计费；失败/释放不退款；超过预算在请求前拒绝", () => {
  const b = fixture({ API_LLM_DAILY_CALLS: "2" });
  try {
    for (let i=0;i<2;i++) { const lease=b.reserve("llm", { units: 100, actor: actor(i) }); lease.release(); lease.release(); }
    assert.throws(()=>b.reserve("llm", {units:100,actor:actor(3)}),{code:"BUDGET_EXHAUSTED"});
    assert.equal(b.snapshot().usage[0].totalCalls,2); assert.equal(b.snapshot().usage[0].totalUnits,200);
    assert.equal(b.snapshot().active,0);
  } finally { b.close(); }
});
test("Token预留单位拒绝超额，缺配置/非法数值 fail closed", () => {
  for (const env of [{ API_LLM_DAILY_UNITS:"0" }, { API_LLM_DAILY_CALLS:"NaN" }, {API_LLM_TOTAL_CALLS:"-1"}]) {
    const b=fixture(env);assert.throws(()=>b.reserve('llm',{units:100}),{code:'BUDGET_CONFIG'});b.close();
  }
  const b=fixture({API_LLM_DAILY_UNITS:"150"});
  b.reserve('llm',{units:100,actor:actor(1)}).release();
  assert.throws(()=>b.reserve('llm',{units:51,actor:actor(1)}),{code:'BUDGET_UNITS'});
  assert.throws(()=>b.reserve('llm',{units:-1}),{code:'BUDGET_INPUT'});
  assert.equal(b.snapshot().usage[0].totalCalls,1);b.close();
});
test("全站和每位玩家并发、每日、每分钟限制不能靠新开游戏会话绕过", () => {
  let b=fixture({API_MAX_CONCURRENT:"2"});
  const a=b.reserve('llm',{units:1,actor:actor(1)});
  assert.throws(()=>b.reserve('llm',{units:1,actor:actor(1)}),{code:'BUDGET_CONCURRENT'});
  const c=b.reserve('llm',{units:1,actor:actor(2)});
  assert.throws(()=>b.reserve('llm',{units:1,actor:actor(3)}),{code:'BUDGET_CONCURRENT'});a.release();c.release();b.close();
  b=fixture({API_LLM_PLAYER_DAILY_CALLS:"1"});b.reserve('llm',{units:1,actor:actor(1)}).release();
  assert.throws(()=>b.reserve('llm',{units:1,actor:actor(1)}),{code:'BUDGET_PLAYER'});b.close();
  b=fixture({API_LLM_IP_DAILY_CALLS:"1"});b.reserve('llm',{units:1,actor:actor(1)}).release();
  assert.throws(()=>b.reserve('llm',{units:1,actor:{player:'new-cookie',ip:'ip1'}}),{code:'BUDGET_IP'});b.close();
  b=fixture({API_PLAYER_PER_MINUTE:"1"});b.reserve('llm',{units:1,actor:actor(1)}).release();
  assert.throws(()=>b.reserve('llm',{units:1,actor:actor(1)}),{code:'BUDGET_RATE'});b.close();
});
test("AsyncLocalStorage 的玩家隔离，不把并行玩家计到同一身份", async () => {
  const b=fixture({API_LLM_PLAYER_DAILY_CALLS:'1'});
  await Promise.all([1,2].map(n=>runBudgetContext(actor(n),async()=>{ await new Promise(r=>setTimeout(r,5));b.reserve('llm',{units:1}).release(); })));
  assert.equal(b.snapshot().usage[0].totalCalls,2);
  assert.throws(()=>runBudgetContext(actor(1),()=>b.reserve('llm',{units:1})),{code:'BUDGET_PLAYER'});b.close();
});
test("跨午夜不重置累计预算；崩溃租约只释放并发不退款", () => {
  let time=Date.UTC(2026,8,13,15,59,0);
  const b=createBudget({env:{...BASE,API_LLM_TOTAL_CALLS:'2'},dbPath:':memory:',now:()=>time});
  b.reserve('llm',{units:1,actor:actor(1)});time+=11*60e3;
  b.reserve('llm',{units:1,actor:actor(1)}).release();
  assert.equal(b.snapshot().usage[0].dailyCalls,1);
  assert.throws(()=>b.reserve('llm',{units:1,actor:actor(2)}),{code:'BUDGET_EXHAUSTED'});b.close();
});
test("签名 Cookie 跨重启稳定；伪造标识/XFF 不绕过 IP 限额；账本不存原始 IP", async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'echo-budget-test-')),dbPath=path.join(dir,'ledger.sqlite');
  let b;
  try {
    const headers={},res={setHeader(k,v){headers[k]=v;}};
    const req={headers:{'x-forwarded-for':'203.0.113.2'},socket:{remoteAddress:'192.0.2.1'}};
    b=createBudget({env:BASE,dbPath});const a=b.actor(req,res),cookie=headers['Set-Cookie'].split(';')[0];
    assert.match(headers['Set-Cookie'],/HttpOnly; SameSite=Lax/);b.close();
    b=createBudget({env:BASE,dbPath});assert.deepEqual(b.actor({...req,headers:{cookie}},res),a);
    const forged=b.actor({...req,headers:{cookie:cookie.replace(/.$/,'!'),'x-forwarded-for':'203.0.113.3'}},res);
    assert.notEqual(forged.player,a.player);assert.equal(forged.ip,a.ip);
    b.reserve('llm',{units:1,actor:a}).release();b.close();b=null;
    assert.ok(!(await readFile(dbPath)).includes(Buffer.from('192.0.2.1')));
  } finally {b?.close();await rm(dir,{recursive:true,force:true});}
});
test("损坏账本不可放行，不自动清空重建历史预算", async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'echo-budget-test-')),dbPath=path.join(dir,'ledger.sqlite');
  try {await writeFile(dbPath,'corrupt-budget');const b=createBudget({env:BASE,dbPath});
    assert.throws(()=>b.reserve('llm',{units:1}),{code:'BUDGET_STORAGE'});assert.equal(b.status().reason,'BUDGET_STORAGE');b.close();
    assert.equal(await readFile(dbPath,'utf8'),'corrupt-budget');
  } finally {await rm(dir,{recursive:true,force:true});}
});
test("同一 SQLite 账本跨独立进程原子放行，重启不重置", async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'echo-budget-test-')),dbPath=path.join(dir,'ledger.sqlite');
  try {
    const env={...BASE,API_LLM_DAILY_CALLS:'4',API_MAX_CONCURRENT:'20'};
    const initial=createBudget({env,dbPath});initial.snapshot();initial.close();
    const moduleUrl=new URL('../lib/budget.mjs',import.meta.url).href;
    const worker=n=>new Promise((resolve,reject)=>{
      const code=`import {createBudget} from ${JSON.stringify(moduleUrl)};const b=createBudget({env:${JSON.stringify(env)},dbPath:${JSON.stringify(dbPath)}});let pass=0;for(let i=0;i<8;i++){try{b.reserve('llm',{units:1,actor:{player:'worker${n}',ip:'worker${n}'}}).release();pass++;}catch(e){if(!e.code?.startsWith('BUDGET_'))throw e;}}b.close();console.log(pass);`;
      const p=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe'],windowsHide:true});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('exit',c=>c?reject(Error(err)):resolve(Number(out.trim())));
    });
    const results=await Promise.all([1,2,3,4].map(worker));assert.equal(results.reduce((a,b)=>a+b,0),4);
    const restarted=createBudget({env,dbPath});assert.equal(restarted.snapshot().usage[0].totalCalls,4);
    assert.throws(()=>restarted.reserve('llm',{units:1}),{code:'BUDGET_EXHAUSTED'});restarted.close();
  } finally {await rm(dir,{recursive:true,force:true});}
});

import { createZhihuClient } from "../lib/zhihu.mjs";
test("知乎实际请求接预算：并发缓存合并、缓存零消耗、超额正确降级", async () => {
  const b=fixture({API_SEARCH_DAILY_CALLS:'1',API_SEARCH_TOTAL_CALLS:'1'});let calls=0;
  const client=createZhihuClient({cacheDir:null,secret:()=>"fake-secret",reserve:kind=>b.reserve(kind),fetchImpl:async()=>{
    calls++;await new Promise(r=>setTimeout(r,10));return Response.json({Code:0,Data:{Items:[{ContentID:'1',Title:'测试资料',Url:'https://www.zhihu.com/question/1',ContentText:'仅mock'}]}});
  }});
  const results=await Promise.all(Array.from({length:20},()=>client.search('相同查询')));
  assert.ok(results.every(r=>r.source==='live'));assert.equal(calls,1);
  assert.equal((await client.search('相同查询')).source,'cache');assert.equal(calls,1);
  const denied=await client.search('另一查询');assert.equal(denied.fallbackReason,'BUDGET_EXHAUSTED');assert.equal(calls,1);
  assert.equal(b.snapshot().usage[0].totalCalls,1);b.close();
});
test("单玩家拒绝不污染公共查询冷却；其他玩家仍可在全站预算内获取", async () => {
  const b=fixture({API_SEARCH_DAILY_CALLS:'5',API_SEARCH_TOTAL_CALLS:'5',API_SEARCH_PLAYER_DAILY_CALLS:'1'});let calls=0;
  const client=createZhihuClient({cacheDir:null,secret:()=>"fake",reserve:kind=>b.reserve(kind),fetchImpl:async()=>{calls++;return Response.json({Code:0,Data:{Items:[]}});}});
  await runBudgetContext(actor(1),()=>client.search('first'));
  assert.equal((await runBudgetContext(actor(1),()=>client.search('shared'))).fallbackReason,'BUDGET_PLAYER');
  await runBudgetContext(actor(2),()=>client.search('shared'));assert.equal(calls,2);b.close();
});

test("账本目录不可创建时不放行，也不覆盖阻挡目录的文件", async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'echo-budget-test-')),blocker=path.join(dir,'blocked');
  try {await writeFile(blocker,'keep');const b=createBudget({env:BASE,dbPath:path.join(blocker,'ledger.sqlite')});
    assert.throws(()=>b.reserve('llm',{units:1}),{code:'BUDGET_STORAGE'});b.close();assert.equal(await readFile(blocker,'utf8'),'keep');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("LLM无限用量跳过累计/每日/玩家/IP额度，仍记账且不影响知乎", () => {
  const b = fixture({ API_LLM_UNLIMITED: "true", API_LLM_DAILY_CALLS: "0", API_LLM_TOTAL_CALLS: "0", API_LLM_DAILY_UNITS: "0", API_LLM_TOTAL_UNITS: "0", API_LLM_PLAYER_DAILY_CALLS: "0", API_LLM_IP_DAILY_CALLS: "0", API_SEARCH_DAILY_CALLS: "1", API_SEARCH_TOTAL_CALLS: "1" });
  try {
    for (let i = 0; i < 25; i++) b.reserve("llm", { units: 100000, actor: actor(1) }).release();
    const report = b.snapshot();
    assert.equal(report.llmUnlimited, true);
    assert.equal(report.usage.find(x => x.kind === "llm").totalCalls, 25);
    assert.equal(report.usage.find(x => x.kind === "llm").totalUnits, 2500000);
    assert.equal(b.status().mode, "available");
    assert.equal(b.status().reason, null);
    b.reserve("search", { actor: actor(1) }).release();
    assert.throws(() => b.reserve("search", { actor: actor(1) }), { code: "BUDGET_EXHAUSTED" });
  } finally { b.close(); }
});

test("LLM无限用量仍遵守总开关、并发、频率和合法输入保护", () => {
  const disabled = fixture({ API_LLM_UNLIMITED: "true", API_LIVE_ENABLED: "false" });
  assert.throws(() => disabled.reserve("llm", { units: 1 }), { code: "BUDGET_DISABLED" }); disabled.close();
  const b = fixture({ API_LLM_UNLIMITED: "true", API_PLAYER_PER_MINUTE: "2" });
  try {
    assert.throws(() => b.reserve("llm", { units: -1 }), { code: "BUDGET_INPUT" });
    const lease = b.reserve("llm", { units: 1, actor: actor(1) });
    assert.throws(() => b.reserve("llm", { units: 1, actor: actor(1) }), { code: "BUDGET_CONCURRENT" });
    lease.release();
    b.reserve("llm", { units: 1, actor: actor(1) }).release();
    assert.throws(() => b.reserve("llm", { units: 1, actor: actor(1) }), { code: "BUDGET_RATE" });
  } finally { b.close(); }
});

test("无限用量必须显式开启，非true不能绕过LLM预算", () => {
  const b = fixture({ API_LLM_UNLIMITED: "yes", API_LLM_DAILY_CALLS: "0" });
  try { assert.throws(() => b.reserve("llm", { units: 1 }), { code: "BUDGET_CONFIG" }); }
  finally { b.close(); }
});
