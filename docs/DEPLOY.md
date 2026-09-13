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

## Sealos 安全部署补充（2026-09-13）

- 本机 `kubeconfig.yaml` 是集群访问凭据，仅供本地部署工具读取；Git 与 Docker 构建必须排除。不要上传、截图或复制其内容到日志。
- Dockerfile 只复制运行所需文件；`.dockerignore` 默认排除所有内容，再允许指定源码与公开素材。不包含 `.env`、预算账本、API 缓存、测试产物或集群配置。
- GitHub Actions 的 `Verify deployment image` 使用 Node 24 运行测试、构建镜像并验证容器健康和敏感路径 404。不需要配置任何真实 API 密钥。测试使用自己的 mock 配置，不能在整个任务上设置 `LLM_PROVIDER=none`。
- 此次部署使用按摘要固定的官方 Node 24 镜像。固定 Git 提交的源码归档经过逐文件 Git 哈希验证和 SHA-256 校验，再通过 Kubernetes API 分块存入当前命名空间的不可变 ConfigMap。initContainer 从挂载的分块重组并校验归档，只提取运行源码与公开素材到共享临时卷，主容器运行 `node server.mjs`。
- 初次尝试直接从 GitHub 下载归档，在 Sealos 实测超时，因此最终配置不再依赖启动时访问 GitHub。ConfigMap 是公开源码的部署载体，不存放应用密钥或 Kubeconfig；不要手工删除仍被当前实例引用的分块。
- 初次公开部署保持单实例、`API_LIVE_ENABLED=false`、`LLM_PROVIDER=none`、`ZHIHU_KNOWLEDGE_ENABLED=false`、`API_SECURE_COOKIE=true`。这表示经典模式完整可玩，不表示真实模型或知乎实时 API 已启用。经典模式不签发实时预算身份 Cookie。
- 容器监听 8080，已有 Service 继续对外提供 80，targetPort 使用容器的命名端口；Ingress 域名与 TLS 配置保持不变。启动、就绪和存活探针均使用 `/api/health`。
- 保留 200m CPU / 256Mi 内存和单实例，不创建 PVC、数据库或自动扩容。滚动更新可能短暂启动替换实例；稳定后恢复单实例。这只是小规模演示配置，不保证大量并发，也不代表平台免费。
- 代码临时卷不是预算持久盘。游戏局保存在内存，重启或更新不保留；开启实时 API 前必须另行批准用量、配置服务端 Secret 和持久化预算账本。
- 公网验证记录、实际发布提交和部署边界见 `docs/SEALOS-DEPLOYMENT-2026-09-13.md`。
