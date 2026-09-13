# 部署说明

> 知乎参考台的接口边界与测试证据见 [ZHIHU-UPGRADE.md](ZHIHU-UPGRADE.md)。`npm start` 不自动加载 `.env`，请使用进程环境或 Node 24+ 的 `node --env-file=.env server.mjs`。

零依赖单进程 Node 服务。任何支持 Node 24+ 的平台都能跑，不需要 `npm install`。

## 本地

```bash
npm start
```

http://127.0.0.1:3000

## 环境变量

全部可选。不配任何变量也能完整通关（走演示数据 + 规则台词）。

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `PORT` | 监听端口 | `3000` |
| `HOST` | 监听地址 | `0.0.0.0` |
| `ZHIHU_ACCESS_SECRET` | 知乎热榜 / 站内搜索 / 直答 | 未配置则降级 |
| `LLM_PROVIDER` | 显式选择 deepseek / openai / zhida / none，优先于自动选择 | 自动选择 |
| `ZHIHU_KNOWLEDGE_ENABLED` | false 禁止知识上游请求，已有缓存仍可读取 | true |
| `ZHIHU_CACHE_DIR` | 知乎 API 缓存目录 | data/cache |
| `LLM_BASE_URL` | OpenAI 兼容端点（如 `https://api.example.com`） | 无 |
| `LLM_API_KEY` | 生成模型密钥（与知乎数据凭据独立） | 无 |
| `LLM_MODEL` | 生成模型名（deepseek 模式默认为 deepseek-flash） | `gpt-4o-mini` |

`ZHIHU_ACCESS_SECRET` 在 https://developer.zhihu.com/profile 申请。

**凭证不要写进代码或提交到仓库。** 部署时用平台的 Secret 配置注入。`.gitignore` 已排除 `.env`、`.env.*`（只保留 `.env.example`）、预算账本与缓存。

**仅配置凭据不会开启实时请求。** 还需明确设置 `API_LIVE_ENABLED=true`、各能力的 `API_*_DAILY_CALLS` 与 `API_*_TOTAL_CALLS`。模型还需批准每日/累计预留单位；0或缺失均拒绝新实时请求，缓存与经典模式仍可玩。完整字段见根目录 `.env.example` 与 [预算保护说明](API-BUDGET-PROTECTION-2026-09-13.md)。不要复制本地测试脚本中的放宽额度作为生产预算。

## Sealos / 任意容器平台

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY . .
ENV PORT=8080 HOST=0.0.0.0
EXPOSE 8080
CMD ["node", "server.mjs"]
```

镜像很小，没有 `npm install` 步骤。

在平台的环境变量里配置 `ZHIHU_ACCESS_SECRET`，健康检查指向 `/api/health`（返回 `{"ok":true,...}`）。

## 需要持久卷吗

**开启实时 API 时必须持久化预算账本。** 将持久卷挂载到 `/app/data/budget`，或通过 `API_BUDGET_DB` 指向受控持久存储；不要在部署或重启时清空数据库、WAL和SHM。否则会丢失累计计数，不能再保证跨重启额度保护。

`data/cache/` 是可选的接口响应缓存；丢失可能增加后续实际请求。游戏会话仍在内存，重启不保留游戏局。多实例不能各自创建独立账本后共享同一密钥，扩容前需要统一的原子预算存储。

如果平台文件系统只读，缓存写入失败会通过 `/api/health` 中的 `capabilities.cacheWarning` 报告，内存缓存仍然工作；预算账本不可写时，则停止新的实时请求。

## Cloudflare Workers

当前实现用了 `node:http`、`node:fs`，不能直接跑在 Workers 上。要上 Workers 需要改造：

1. 换成 `fetch` handler 形式
2. 静态资源交给 Cloudflare Pages
3. 会话状态换成 Durable Objects 或 KV
4. 磁盘缓存换成适合的共享存储
5. SQLite预算预留迁移到提供原子事务的共享服务，不能只用最终一致性的计数替代

`lib/engine.mjs` 是纯逻辑，可以复用；会话、预算事务与部署适配仍需单独设计和验证，不是当前版本的形态。**推荐用支持 Node 运行时的平台。**

## 验证部署成功

```bash
curl https://<你的域名>/api/health
```

期望返回：

```json
{"ok":true,"project":"echo-post","zhihu":"live","llm":"deepseek","letters":3,"sessions":0}
```

- `zhihu: "live"` 是历史兼容字段，仅表示配置存在；`"demo-fallback"` 表示未配置。实际请求是否成功应读取 `capabilities.hot/search/knowledge` 的 source、fetchedAt、stale、fallbackReason
- `llm: "zhida"` 仅表示识别到直答配置，当前因最大输出限制未核实而规则降级；`"deepseek"` 为 DeepSeek 配置；`"openai"` 为兼容端点配置；`"none"` 走规则引擎

这些是配置/最近请求状态，不保证下一次生成成功。打开游戏查看每张资料卡的实际来源。走完一局确认四个阶段都正常。

## OAuth 说明

本作**不要求**知乎账号 OAuth。当前只有可选登录预留入口，不发起真实授权、不处理Token交换、不访问个人关注或收藏。未配置或未授权时保持公共参考模式。未来真实OAuth需另行接入并登记公网HTTPS回调，不能把登录当作搜索额度切换。
