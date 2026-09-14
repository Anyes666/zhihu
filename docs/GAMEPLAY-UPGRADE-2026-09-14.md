# 回声邮局 · 玩法与新手升级交付记录

日期：2026-09-14（Asia/Shanghai）
状态：**开发、自动化验收、Sealos发布及公网点击验收完成；真人新手/真机软键盘/本人OAuth与真实AI验收未执行。**

## 1. 已交付范围

### P0 正确性与新手
- 统一 `evidence`：已确认真相 x/y 与回信依据覆盖分离；结局、时间线、档案卡、复制文案、平行对照共用新标签。原评分、结局枚举、阈值、资源规则不变。
- 两句原创独立练习：事实/情绪，先选句再分类，错误就近解释，可重试/跳过/重玩；六类帮助含解释与例子。保留底部折叠游戏介绍，首次摘要提示位置，不强制重复阅读。
- 练习不建游戏会话、不联网、不加减游戏资源。已加载页面后断开API仍可练习；**正式游戏仍需要连接服务器，不是离线游戏。**
- 引导元信息 v1→v2 保留跳过/完成选择及旧状态，不清空草稿。提示卡就近置于正常文档流，不用底部遮罩挡操作。
- 手机完整选句及六类按钮同屏；四种资源有可点击的完整解释，邀请/开场/编辑/发送成本明确。
- 普通玩家看经典模式说明，预算原因在折叠详情；每段模型/规则来源标签仍保留。

### P1 调查与表达
- 成功提问回执：真实邮票前后、信任前后、规则态度、关系氛围、是否新增线索和后续可选动作。失败不造回执，重复请求明确显示原回执而非重复扣费。
- 线索板分来信明示事实（寄信人陈述，非独立核实）、对话/档案确认、待问清方向；来源清楚，知乎笔记不变成本案事实。
- 已公开线索可填入提问方向，但不会自动发送或消费。
- 可折叠“事实/感受/下一步”写作扶手，保留自由编辑，不自动拼标准稿；最低10字与建议120–600字区分。
- 响应不完整先核实服务端；双重断网时恢复入口不随角色切换丢失；旧局迟到成功/失败不影响新局。

### P2 既有特色增强
- 平行试写与“再接一封信”并列；两稿实际增删片段、真实五维原值→新值、变化与不变、已确认数量/依据覆盖并列。
- 规则记录与字面diff不是精确逐句评分因果；无法解释的部分明确说未提供依据。正式档案只读，编辑/失败清掉旧成功结果，重试不消耗邮票。
- 现有LLM保留同角色最近3轮上下文；点评依据规则反馈，不编精确得分因果。损坏流、截断、超时、无Key降级，不吞上游JSON错误。
- **没有开启真实付费AI、提高预算、读取个人知乎资料或假装完成本人OAuth。**

## 2. 本轮实际验证

| 检查 | 结果与范围 |
|---|---|
| 基线 | 语法通过，128项单测通过；原体验Chrome回归通过 |
| 最终 `npm run check` / `npm test` | 通过；245项，0失败、0跳过 |
| `git diff --check` | 通过；仅已有换行策略的LF→CRLF提示 |
| `scripts/browser-onboarding.mjs` | 实际鼠标/键盘；错分重试、API断网练习、跳过重玩、320/390/桌面、刷新草稿、完整首局、存储拒绝；通过 |
| `scripts/browser-experience.mjs` | 参考台本地mock、角色切换、完整结局、风险平行稿、不覆盖档案；通过 |
| `scripts/browser-research.mjs` | 来源、笔记、参考台回归；通过 |
| `scripts/browser-auth.mjs` | 14项UI与故障检查，使用本地mock，非本人授权；通过 |
| `scripts/browser-budget.mjs` | 本地mock仅允许1次，真实SQLite预算阻止后续调用，经典模式完整通关；通过 |
| `scripts/browser-gameplay.mjs` | 三封信分别320×568、390×844、1440×1000，真实点击全流程；键盘分类、失败/重放/截断恢复、草稿、对照；通过 |
| `scripts/browser-recovery.mjs` | 双重断网→切角色恢复；结束失败后新局；旧状态请求挂起期间新局再放行失败；3项通过 |
| `scripts/audit-integration.mjs` | 22项API审计通过 |
| `scripts/audit-browser.mjs` | 15项实际Chrome探索通过，含仅键盘九句分类、撤回、封存及错误恢复 |
| 公网站点 | 新profile真实点击练习→九句→邀请→提问→写作/刷新→结局→平行试写，通过；浏览器异常0 |
| 视觉检查 | 主代理查看了练习错误理由、320完整选句、行动回执、结果口径、平行对照、网络恢复及公网截图，不仅DOM断言 |

公开站点本次平行对照：原稿温度59、改稿67（+8），其余维度不变，结局保持“先停下来”；已确认1/2，依据覆盖1.5/2。**这只是本次规则模拟，不是现实人生预测。**

## 3. 发布与安全

- 发布标识：`11747a4a9d8a`，Deployment generation `8`，1副本/1就绪。
- 首次 Sealos 发布使用测试过的工作区源码包，当时未提交 Git；随后用户明确授权同步 GitHub，本次提交包含对应源码、测试和文档。分支：`codex/gameplay-onboarding-upgrade-20260914`，基准HEAD `214121e`。
- 仅42个运行时文件，16个不可变ConfigMap分块；本地和远端完整包SHA-256均核实，8个公网前端文件逐个哈希与发布清单一致。
- 完整包SHA-256：`81d0d2012e94d32b8ec252d9fd4d3c0556c41d65bc9f2395f3f5e5d5337da156`。
- 容器环境、Secret引用、CPU/内存、预算和单副本配置与发布前一致；不把测试、视频、工具、`.env`、kubeconfig或工作区文档上传。
- 密钥值只用于内存比对扫描，未输出到日志或写到前端。OAuth配置仍存在，未登录状态个性化不可用是正常权限控制。
- 内存游戏/登录会话在滚动更新后可能失效；发布前已说明。长期持久化未纳入本轮。
- 回滚备份、发布脚本和清单仅保存在已忽略的 `D:/A黑客松/artifacts/gameplay-upgrade-20260914/`。保留旧源码块，不删除用户既有资源。

## 4. 实际失败与处理记录

- 新增模块执行中的红测曾被主代理过早误称为CSS串接问题；进一步读取后已更正，实际是未完成实现，未用修改测试掩盖。
- 子任务Python中文管道出现字面问号；已恢复原稿，增加UTF-8内容回归并通过浏览器检查。
- 首轮浏览器发现角色切换旧草稿残留，已明确在成功打开角色时清空；平行结果在请求中清空后旧等待断言有空节点问题，改为等待实际新结果。
- 原预算浏览器回归发现降级时主提示仍显示“已配置”，已修为本段经典模式、详细原因折叠，回归通过。
- 独立审查发现断网核实入口和跨局迟到回调缺陷；两轮真实Chrome红绿及独立复核后关闭。
- 初次公开状态检查误用了 `/auth/status`，404；正确 `/api/auth/zhihu/status` 已验证configured=true、authenticated=false。
- 首次部署包缺显式目录项，新init解包失败；旧副本仍可用。通过日志定位，补目录条目，并按原init选择路径实际解包，42个文件哈希一致后修复发布。没有放宽安全校验。
- 本机PATH里的旧GAMS tar不支持gzip，未用其失败冒充包校验；改用Python条目检查和Windows系统tar完成验证。
- 末次证据汇总脚本默认GBK读取中文JSON失败，指定UTF-8重跑通过；不影响线上程序。

## 5. 明确未完成的外部验收

1. **3名首次玩家人工可用性测试**：尚无人参与。目标“至少2/3在90秒内完成练习和第一句分类、理解邮票扣费”没有被宣布达成。执行卡见同目录 `FIRST-PLAYER-TEST-2026-09-14.md`。
2. **真实手机软键盘**：只测Chrome移动视口，不是Android/iOS真机；键盘弹起、旋转、安全区仍需实机确认。
3. **本人知乎OAuth及个人引导**：配置和本地mock UI已验证，真实账号授权需要用户本人操作。
4. **真实AI质量、延迟、费用**：未启用新的调用。需另行明确有界预算后测试；prompt/mock不能保证真实模型绝不幻觉。

## 6. 文件变更清单

- `D:/A黑客松/lib/engine.mjs`
- `D:/A黑客松/lib/llm.mjs`
- `D:/A黑客松/lib/rehearsal.mjs`
- `D:/A黑客松/package.json`
- `D:/A黑客松/public/app.js`
- `D:/A黑客松/public/experience.css`
- `D:/A黑客松/public/index.html`
- `D:/A黑客松/public/onboarding.css`
- `D:/A黑客松/public/onboarding.js`
- `D:/A黑客松/public/rehearsal.js`
- `D:/A黑客松/public/styles.css`
- `D:/A黑客松/scripts/browser-budget.mjs`
- `D:/A黑客松/scripts/browser-experience.mjs`
- `D:/A黑客松/scripts/browser-onboarding.mjs`
- `D:/A黑客松/server.mjs`
- `D:/A黑客松/tests/llm-research.test.mjs`
- `D:/A黑客松/tests/llm.test.mjs`
- `D:/A黑客松/tests/rehearsal.test.mjs`
- `D:/A黑客松/tests/server.test.mjs`
- `D:/A黑客松/public/investigation.js`
- `D:/A黑客松/scripts/browser-gameplay.mjs`
- `D:/A黑客松/scripts/browser-recovery.mjs`
- `D:/A黑客松/tests/investigation.test.mjs`
- `D:/A黑客松/tests/onboarding-practice.test.mjs`
- `D:/A黑客松/tests/upgrade-engine.test.mjs`
- `D:/A黑客松/docs/GAMEPLAY-UPGRADE-2026-09-14.md`
- `D:/A黑客松/docs/FIRST-PLAYER-TEST-2026-09-14.md`
- 计划状态：`D:/A黑客松/.Codex/plans/gameplay-onboarding-upgrade-2026-09-14.md`（已忽略）。

## 7. 证据位置

- 总目录：`D:/A黑客松/artifacts/gameplay-upgrade-20260914/`
- 最终单测：`final-tests.log`；语法：`final-check.log`
- 三封信：`final-gameplay/browser-report.json`
- 新手：`onboarding/browser-report.json`、`regression-onboarding/browser-report.json`
- 网络恢复：`recovery-green/browser-report.json`（对应各轮red日志保留）
- 公网：`public-browser/browser-report.json`、`public-browser/01-public-practice.png`、`03-public-sort-320.png`、`04-public-receipt.png`、`06-public-ending.png`、`07-public-parallel.png`
- 部署：`release-verification.json`、`release.json`、`deployment-before.json`；仅本地保存，不要上传整个目录。

## 8. GitHub 同步说明（2026-09-14）

用户在公网验收后明确要求同步 GitHub。仓库首页已补充正式访问入口和升级说明。此次提交仅包含游戏源码、测试脚本及相关文档，不包含视频、工具、密钥或本地验收目录。

正式站点仍为 https://agrdkgglknfj.sealosbja.site/ ，仓库为 https://github.com/Anyes666/zhihu 。这次同步不改变玩法、服务端环境或预算；公网沿用已验收的发布包。推送后的提交哈希、远程 CI 和公网一致性核验另存本地交付记录，不预先宣称远程 CI 已成功。
