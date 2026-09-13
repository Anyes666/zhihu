# 知乎登录与个性化参考

本次接入复用现有 Node 服务，登录可选，未登录也可完整游玩。安装过的官方 Skill 不替代生产登录服务。

## 配置（只在服务器配置真实值）

Sealos Secret `echo-post-zhihu-oauth` 保存：
- `ZHIHU_OAUTH_APP_ID`：赛事应用 ID。
- `ZHIHU_OAUTH_APP_KEY`：应用密钥；禁止放到前端、代码仓库、Docker 构建参数或日志。
- `ZHIHU_OAUTH_REDIRECT_URI`：已登记的公网 HTTPS `/auth/callback`，必须完全一致。
- `ZHIHU_ACCESS_SECRET`：开放平台调用方鉴权，仅服务端用户列表请求使用；不能代替用户 OAuth Token。

普通环境变量：
- `ZHIHU_PERSONALIZATION_ENABLED=true`：开放主动生成个性化参考入口。
- `ZHIHU_OAUTH_MAX_REQUESTS=200`：整个进程共用的上游请求次数上限，包括换 Token、基础信息和用户列表；0 为禁止请求。**进程重启会归零，不是持久化日预算或平台费用上限**。
- 游戏的 `API_LIVE_ENABLED=false`、`LLM_PROVIDER=none`、`ZHIHU_KNOWLEDGE_ENABLED=false` 可保持不变。OAuth 使用独立请求通道，不调用模型。

先创建 Secret，再使用 `secretKeyRef` 引用并滚动重启。切勿把 Secret 导出到公开文件。新版本可先在 OAuth 未配置状态上线，身份接口会如实返回 `configured:false`。

## 路由与使用

1. `GET /api/auth/zhihu/status`：不读取用户列表，不返回 Token。
2. `POST /api/auth/zhihu/login`：验证同源，创建五分钟的一次性 state，返回知乎官方授权 URL；浏览器同标签页跳转，保留已有 sessionStorage 游戏进度。
3. 用户本人登录并确认授权；`GET /auth/callback` 接收 `authorization_code` 或 `code`，严格验证 Cookie 和唯一 state 后交换 Token，再读取昵称和头像。回调立即 303 到无授权码的首页。
4. `POST /api/auth/zhihu/personalization`：由用户主动点击；每次登录最多读取创作、关注、收藏夹、首个有效收藏夹内容、收藏文章五个列表，各最多一条。资料为空或失败时给出公共参考说明，不冒充真实个性化。
5. `POST /api/auth/zhihu/logout`：清除服务端会话与浏览器身份 Cookie。

主题匹配为确定性规则，不向模型发送个人资料，不推断性格或私人经历，不改变评分或自动代选。个性化结果只保留粗粒度主题与游戏来信建议。原始列表不持久化。

## 安全边界及运维

- App Key、Access Secret 和 OAuth Token 不返回前端。浏览器只持有随机 `HttpOnly; Secure; SameSite=Lax` 会话 Cookie。
- Token 仅存单副本进程内存，最多八小时且不超过上游有效期。退出/过期失效；服务重启需重新登录。**不支持多副本共享登录或自动刷新 Token**；不要直接扩副本。
- 最多500个会话，按连接来源限速，最多三个并发上游请求，固定官方主机、不跟随重定向，八秒请求超时，256KiB响应上限。
- 开放平台鉴权失败停止读取，不回退到开发者本人资料。
- 应禁用该应用 Ingress access log，避免记录回调查询参数。应用不记录授权码/上游正文；平台级边缘日志策略仍需要平台管理员保证。
- 官方资料记录过回调不返回 state 的历史情况。本实现不会绕过校验。若实际授权返回 `state_invalid`，必须向平台确认 state 支持，不能声称已成功登录，也不能通过拼接固定 state 降级。
- 共享请求次数耗尽只影响登录/个性化，不影响公共玩法；应结合平台额度监控。不得为了规避额度反复重启。
- 密钥若曾发到聊天或公开渠道，建议在平台轮换后更新 Secret。

## 验证方法

`npm run check`、`npm test`；真实 Chrome 本地检查 `node scripts/browser-auth.mjs`、`node scripts/browser-onboarding.mjs`；完整游戏回归 `node scripts/audit-integration.mjs`、`node scripts/audit-browser.mjs`。

测试使用假凭据/明确的本地上游 mock，不等于真实知乎授权验收。上线后需要用户本人完成官方授权，确认昵称头像、主动个性化与退出；不得记录真实授权码、Token 或个人列表作为验收截图。
