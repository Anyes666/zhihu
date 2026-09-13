// TEST ONLY. Explicit preload used by browser regression scripts; never imported by server.mjs.
// Keeps the knowledge contract exercised without spending quotas or requiring public internet.
if (process.env.NODE_ENV !== "test") throw new Error("Knowledge mock is test-only");
const original = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.href === "https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/list")
    return Response.json([{ work_id: "1307332455322529792", title: "心理被动（本地 mock 测试资料）", description: "此内容仅用于测试参考台与适用边界，不是真实知乎知识。先区分自己的意愿与被动迎合，再向当事人确认。", labels: ["心理", "本地测试"] }]);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("External network disabled in browser regression");
  return original(input, options);
};
