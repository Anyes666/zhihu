import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createZhihuClient, sourceUrl } from "../lib/zhihu.mjs";
const api = items => new Response(JSON.stringify({ Code: 0, Data: { Items: items } }), { headers: { "Content-Type": "application/json" } });
const item = { Title: "<b>如何沟通？</b>", ContentID: "1234567890123456789", ContentType: "answer", Url: "https://www.zhihu.com/question/12/answer/34", ContentText: "<p>先倾听对方。</p>", AuthorName: "答主甲", VoteUpCount: 32, CommentCount: 4, EditTime: 1700000000, CommentInfoList: [{ Content: "精选看法" }] };
const opts = { reserve: () => ({ release() {} }), cacheDir: null, secret: () => "test-secret-not-real" };
test("官方搜索协议：Bearer + 秒级时间戳，Query/Count，大整数 ID 与文本规范化", async () => {
  let called;
  const client = createZhihuClient({ ...opts, now: () => 1800000000000, fetchImpl: async (url, options) => { called = { url: new URL(url), options }; return api([item]); } });
  const r = await client.search("亲子 边界", 3);
  assert.equal(called.url.pathname, "/api/v1/content/zhihu_search"); assert.equal(called.url.searchParams.get("Query"), "亲子 边界"); assert.equal(called.url.searchParams.get("Count"), "10");
  assert.equal(called.options.headers.Authorization, "Bearer test-secret-not-real"); assert.equal(called.options.headers["X-Request-Timestamp"], "1800000000");
  assert.equal(r.source, "live"); assert.equal(r.items[0].title, "如何沟通？"); assert.equal(r.items[0].text, "先倾听对方。"); assert.equal(r.items[0].id, item.ContentID); assert.equal(r.items[0].votes, 32);
});
test("热榜大写 Limit 参数，调用成功后才标注 live", async () => {
  const client = createZhihuClient({ ...opts, fetchImpl: async url => { assert.equal(new URL(url).searchParams.get("Limit"), "30"); return api([{ Title: "一个热点", Url: "https://www.zhihu.com/question/1", Summary: "摘要" }]); } });
  assert.equal(client.capabilityStatus().hot, undefined); assert.equal((await client.hotList(1)).source, "live"); assert.equal(client.capabilityStatus().hot.source, "live");
});
test("知识列表不带鉴权，保留官方 work_id，缺作者不编造", async () => {
  const client = createZhihuClient({ ...opts, fetchImpl: async (url, options) => { assert.equal(new URL(url).pathname, "/km-indep-home/hackathon/v2/knowledge/list"); assert.equal(options.headers.Authorization, undefined); return Response.json([{ work_id: "1307332455322529792", title: "方法参考", description: "<p>简介</p>", labels: ["职场"] }]); } });
  const r = await client.knowledgeList(); assert.equal(r.source, "live"); assert.equal(r.items[0].author, "列表未提供作者"); assert.equal(r.items[0].text, "简介");
});
test("安全来源链接拒绝脚本、外域与伪知乎域名", () => {
  for (const url of ["javascript:alert(1)", "https://zhihu.com.evil.test/", "http://www.zhihu.com/", "https://evil.test/"]) assert.equal(sourceUrl(url), "");
  assert.equal(sourceUrl("https://www.zhihu.com/question/1"), "https://www.zhihu.com/question/1");
});
test("并发去重与不同 count 读取完整缓存，不重复调用 API", async () => {
  let calls = 0;
  const client = createZhihuClient({ ...opts, fetchImpl: async () => { calls++; await new Promise(r => setTimeout(r, 20)); return api(Array.from({ length: 10 }, (_, i) => ({ ...item, Title: "问题" + i }))); } });
  const rs = await Promise.all(Array.from({ length: 8 }, () => client.search("同一查询", 1)));
  assert.equal(calls, 1); assert.ok(rs.every(r => r.items.length === 1)); const later = await client.search("同一查询", 8); assert.equal(later.items.length, 8); assert.equal(later.source, "cache"); assert.equal(calls, 1);
});
test("失败冷却不能被轮询无限续期，60 秒后能重试", async () => {
  let time = 1800000000000, calls = 0;
  const client = createZhihuClient({ ...opts, now: () => time, fetchImpl: async () => { calls++; return new Response("do-not-expose-secret", { status: 429 }); } });
  const first = await client.search("冷却测试"); assert.equal(first.fallbackReason, "HTTP_429"); assert.ok(!JSON.stringify(first).includes("do-not-expose-secret"));
  time += 30000; await client.search("冷却测试"); assert.equal(calls, 1);
  time += 31000; await client.search("冷却测试"); assert.equal(calls, 2);
});
test("缓存过期且上游失败，返回明确 stale 的真实旧缓存而非假实时", async () => {
  let time = 1800000000000, fail = false;
  const client = createZhihuClient({ ...opts, now: () => time, fetchImpl: async () => fail ? new Response("", { status: 503 }) : api([item]) });
  const live = await client.search("缓存过期"); time += 6 * 3600e3 + 1; fail = true;
  const stale = await client.search("缓存过期"); assert.equal(stale.source, "cache"); assert.equal(stale.stale, true); assert.equal(stale.fetchedAt, live.fetchedAt); assert.equal(stale.fallbackReason, "HTTP_503");
});
test("本地每日额度保护在网络请求前生效", async () => {
  let calls = 0;
  const client = createZhihuClient({ ...opts, dailyLimits: { search: 1 }, fetchImpl: async () => { calls++; return api([item]); } });
  assert.equal((await client.search("第一个主题")).source, "live"); assert.equal((await client.search("第二个主题")).fallbackReason, "DAILY_LOCAL"); assert.equal(calls, 1);
});
test("无凭证不发鉴权请求，演示不写入真实缓存；知识关闭可离线", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "echo-zhihu-test-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const client = createZhihuClient({ secret: () => "", cacheDir: dir, knowledgeEnabled: () => false, fetchImpl: async () => { throw new Error("不应触网"); } });
  const r = await client.search("离开", 3, "search_leaving"); assert.equal(r.source, "demo"); assert.equal(r.fallbackReason, "NO_SECRET"); assert.ok(r.items.length > 0);
  assert.equal((await readdir(dir)).length, 0); assert.equal((await client.knowledgeList()).source, "unavailable");
});
test("两级缓存跨实例命中，不包含凭据", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "echo-zhihu-test-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const first = createZhihuClient({ ...opts, cacheDir: dir, fetchImpl: async () => api([item]) }); await first.search("磁盘缓存");
  const second = createZhihuClient({ ...opts, cacheDir: dir, fetchImpl: async () => { throw new Error("不应调用"); } }); assert.equal((await second.search("磁盘缓存")).source, "cache");
  const text = await readFile(path.join(dir, (await readdir(dir))[0]), "utf8"); assert.ok(!text.includes("test-secret-not-real"));
});
test("上游结构错误及超时明确降级，不以 live 冒充成功", async () => {
  const invalid = createZhihuClient({ ...opts, fetchImpl: async () => Response.json({ Code: 0, Data: {} }) }); assert.equal((await invalid.search("结构错误")).fallbackReason, "INVALID");
  const timeout = createZhihuClient({ ...opts, timeoutMs: 20, fetchImpl: async (_, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })) });
  assert.equal((await timeout.search("超时测试")).fallbackReason, "TIMEOUT");
});
