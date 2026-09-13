# 知会 · 班级通知看板

线上网站：[https://classboard-inbox.pages.dev](https://classboard-inbox.pages.dev/)。2026-09-13 已上线账号升级，连接 Cloudflare Pages 和远程 D1，提供 6 条示例通知。全站通知须登录并完成首次改密后才能查看。

交付验证：21 条解析/OCR 单元测试、构建和接口集成测试通过；本地浏览器确认首次改密门禁和个人设置入口，线上班委及同学登录、角色与首次改密门禁通过。可运行 `node scripts/verify-live.mjs` 复查线上匿名访问隔离。OCR 实际样例识别在上一版本验收，本次识别逻辑未更改。可选 LLM 未配置真实服务，默认使用规则解析；班委登录后从“群消息导入”进入草稿与审核流程。

React + TypeScript + Cloudflare Pages Functions + D1 的班级通知网站。群消息先解析为草稿，班委审核后才公开。

## 实现范围

- 今日看板、全部通知、分类 / 时间 / 未读筛选、搜索、近期七天日程与倒计时。
- 标题、正文、发布时间、活动时间、截止时间、地点、通知对象、四种分类、置顶、过期和个人已读同步。
- 班委账号登录、发布、编辑、归档，乐观锁避免并发修改互相覆盖。
- QQ / 微信文本导入，批量草稿、字段修正、原文对照、重复内容跳过。
- 待审核 → 发布 / 驳回。原文与待审内容不会通过同学接口返回，未登录无法读取通知。
- 中文截图 OCR：PNG / JPG / WebP，最大 10 MB、1600 万像素；图片在浏览器识别，可编辑识别结果后解析。
- 独立、无外部依赖的规则解析器；可选 OpenAI 兼容接口增强，失败、超时、无效结构自动回退规则。

MVP 的“自动导入”指 **粘贴或选择截图之后自动结构化**，尚不监听 QQ / 微信群。机器人接入见路线图。

## 选型：Build，而非 Fork

已研究以下项目的 README、文件结构及依赖；未直接复制其业务代码。

| 项目 | 技术 / 功能 | 许可证与取舍 |
| --- | --- | --- |
| [luoling8192/ClassTools](https://github.com/luoling8192/ClassTools) | React 17、CRA、Ant Design；作业、课表与倒计时，后端独立 | 已归档；调研时未发现明确许可证；升级及补齐导入审核成本较高 |
| [cloudy059/HomeworkBoard](https://github.com/cloudy059/HomeworkBoard) | 原生 HTML / CSS / JS，作业和出勤，localStorage | 调研时未发现明确许可证；本地存储不能作为多人共享数据库 |
| [educatres/classboard](https://github.com/educatres/classboard) | Google Form / Sheet 支撑的便签共创墙，无登录权限 | MIT；模型偏便签，迁移存储、身份、审核收益有限 |

视觉与模块参考 [classboard-njupt demo](https://classboard-njupt.pages.dev/)：蓝白卡片、今日、日程、建议与班委管理。本站围绕“导入 → 草稿 → 审核”重建，未沿用紧急绕过审核及公开待审批条目的行为。

复用 React、Vite、Lucide、Tesseract.js；没有自行实现 OCR 引擎。依赖准确版本见 lockfile。Tesseract.js 为 Apache-2.0；其他依赖许可按各自包文件保留。

## 本地运行

需要 Node.js 22.12+、npm。所有命令在本项目目录执行。

```sh
npm ci
npm run build
npm run db:migrate
npm run db:seed
npm run dev
```

打开 http://127.0.0.1:5173 。Vite 代理 `/api` 到本地 Pages 8788；数据保存在 `.wrangler/state`，刷新页面不会丢失。示例数据只在显式运行 seed 时写入，不会在服务启动时自动填充。再次 seed 不覆盖已有示例。

前端开发支持热更新。修改 `server/` 或解析器之后运行 `npm run build`，Pages 开发服务会重新加载 Worker。如只需验证生产构建，运行 `npm run preview` 并打开 http://127.0.0.1:8788 。

### 创建班级账号

新版使用姓名、学号、密码登录，角色为 committee / student。首次登录必须先修改密码，新密码至少 12 位。旧 admins 记录保留但不再参与登录；没有公开注册入口。

先执行数据库迁移，然后在 Git 忽略目录 `work/` 准备 JSON 数组，每项包含 `name` 和字符串类型的 `student_id`。本次 29 人、两列无标题的原始 Excel 可用以下脚本提取（其他格式请先整理为 JSON）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/read-roster.ps1 -Workbook "你的名单.xlsx"
```

运行 `node scripts/accounts.mjs --roster work/roster.json --committee "班委姓名"`，线上加 `--remote`。初始密码通过标准输入提供，不放进命令参数或 Git；推荐使用下面的交互式本机工具，它使用隐藏输入并通过进程管道传递：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-accounts.ps1 -Roster work/roster.json -Committee "班委姓名"
# 线上加 -Remote；重置单个账号改用 -Reset "学号" -Remote
```

导入校验空字段、重复学号、班委唯一性及现有账号姓名/角色冲突；重复执行跳过已有账号，不覆盖密码。每人使用独立随机盐和 PBKDF2-SHA256 摘要。临时 SQL 自动删除；名单、派生值不进入 Git 或静态资源。

### 忘记密码

维护者使用上述本机工具的 `-Reset "学号"` 参数，输入临时密码。工具撤销此人的所有会话并重新要求首次改密。无需删除重建账号，个人已读记录保留。旧 `admin:setup` 流程已停用。

会话 Cookie 使用 HttpOnly、SameSite=Strict 和 HTTPS Secure，有效期 8 小时。登录及修改密码失败会限速。修改密码后所有设备须重新登录。

## 使用群消息解析

1. 登录班委账号，进入「群消息导入」。
2. 粘贴文本，或选择清晰截图；OCR 结果可以手动修正。
3. 设置消息基准时间。原文含消息发送日期时，该条消息优先使用原日期。
4. 点击「生成通知草稿」，检查标题、分类、地点、活动与截止时间。
5. 对不确定字段进行修改，选中需要导入的条目，加入待审核。
6. 进入「通知管理 → 待审核」，对照原文后审核发布，或驳回。

所有时间按 **Asia/Shanghai** 解释，数据库保存带时区的 ISO 时间；没有明确钟点时不自动补午夜。“已过期”优先按截止时间判断，无截止时按活动时间判断；长期通知不过期。日程分别显示活动和截止，不因报名截止已过而遗漏未来活动。

规则解析器：`src/parser/index.ts`。公开接口：

```ts
parseRules(text, { referenceDate: '2026-09-09T10:00:00+08:00' })
parseMessages(text, context, optionalAdapter, timeoutMs)
```

返回 `drafts`、`engine`、`warnings`、`ignored`。适配器只负责返回候选结构，不具备发布能力。消息最多 20,000 字，每批最多 30 个草稿；精确重复正文会在待审和已发布范围内跳过。不同措辞的近似重复、复杂跨消息指代、撤回与旧通知更新仍需人工判断。

### 典型用例

基准时间：2026-09-09 10:00（北京时间）。以下是测试输入与预期，而非生产通知。

| 输入 | 预期 |
| --- | --- |
| `@全体成员 高数第3章习题，明晚8点前提交到学习通。` | 作业；9月10日20:00 截止；对象全体成员 |
| `周五下午3点在教三201开班会，周四18点前完成报名。` | 事务；9月11日15:00 活动；9月10日18:00 截止；教三201 |
| `@软件1班 明天上午8点的英语课改到教二305。` | 课程；9月10日08:00；教二305；无截止 |
| `志愿活动9月12日9:00在图书馆集合，9月11日中午12点报名截止。` | 活动；9月12日09:00 集合；9月11日12:00 截止 |
| `张老师 2026/09/08 19:30：明天17点前交实验报告。` | 按原消息日期，9月9日17:00 截止 |
| `收到，谢谢老师。` | 不生成草稿 |
| `请在周五前提交作业。` | 截止时间留空，提示缺少明确钟点 |

### OCR 说明

Tesseract.js 7 与 WASM 在构建时复制至站点；语言模型首次使用时从 Tesseract 的公开模型站加载，需要网络。中文聊天气泡、低分辨率和压缩图可能影响识别。首次加载较慢，建议截取少量清晰消息。模型加载失败会显示错误，可改用粘贴文本。

不会上传原截图；用户点击解析后，识别文本发送至本站接口。只有显式选择增强解析时，文本才会发送至配置的 LLM 提供方。请在审核页确认 OCR 中的日期数字没有识别错误。

### 可选 LLM

在 Pages 项目设置中配置以下运行时变量，然后重新部署：

- `LLM_ENDPOINT`：完整 HTTPS chat completions 地址，由维护者固定配置。
- `LLM_MODEL`：模型名称。
- `LLM_KEY`：使用加密 secret 类型配置。不要放入前端变量、源码或 Git。

全部配置齐全后，导入页显示“增强解析”开关；默认不启用。服务端拒绝重定向，设置 8 秒超时并校验返回结构。失败自动保留规则结果。没有配置也能完成全部核心流程；外部 LLM 是否收费由提供方决定。

## Cloudflare Pages 部署

D1 数据库与 Pages 项目均使用 `classboard-inbox`。配置中现有数据库 ID 对应本次创建的数据库；部署到其他账户时，应替换为自己创建的 D1 ID，不要沿用。

首次使用 Wrangler 时，由维护者自行在浏览器完成官方登录授权：

```sh
npx wrangler login
```

新账户首次创建资源（已存在则跳过）：

```sh
npx wrangler d1 create classboard-inbox
npx wrangler pages project create classboard-inbox --production-branch main
```

将创建结果中的数据库 ID 写入 `wrangler.jsonc` 后：

```sh
npx wrangler d1 migrations apply classboard-inbox --remote
npm run deploy
```

发布使用 `dist` 目录，`dist/_worker.js` 是 Pages advanced-mode API 服务。`_routes.json` 仅将 `/api/*` 交给 Functions，静态页面走 Pages 静态资源。部署后在输出的 HTTPS 地址验证。

需要演示数据时显式执行（不会创建班委账号）：

```sh
node scripts/seed.mjs --remote
```

然后按上文运行账号导入工具，加上 `--remote` 写入线上数据库。用户以姓名、学号和初始密码登录，完成改密后重新登录进入看板。部署前应核对目标数据库及 Pages 项目。

`scripts/package-connector.mjs` 另提供 API 直接上传打包形式，供有 Cloudflare API 连接的环境使用。该变体把应用小文件嵌入 Worker，OCR 引擎通过固定版本 CDN 路径代理；全部请求会计入 Functions 额度。它不参与常规 `npm run deploy`，日常维护优先用上面的标准静态部署方式。

### 免费额度

Pages 静态请求、Functions 与 D1 的免费额度按 Cloudflare 当前账户计划执行，不代表无限用量。参考 [Pages 计费](https://developers.cloudflare.com/pages/functions/pricing/) 和 [D1 计费](https://developers.cloudflare.com/d1/platform/pricing/)。按班级规模起步，无需购买服务器；大规模使用前检查用量。

## 测试与验收

```sh
npm test
npm run build
npm run test:integration
```

`test:integration` 使用隔离的 Miniflare D1 和每次随机生成的测试身份，不连接线上数据库，不输出账号凭据。构建失败时不要继续使用旧 `dist` 做验收。

- 解析单测覆盖典型群消息、相对时间、半点、跨年、无效日期、多草稿、变更提醒及 LLM 异常 / 超时 / 坏结构回退。
- 集成验证覆盖真实 Worker 路由：登录、来源校验、游客权限、发布、筛选、置顶、乐观锁、待审内容不可见、审核、归档、精确去重与退出。
- 浏览器验收：发布通知 → 同学登录查看 → 分类筛选 → 导入 → 原文检查 → 审核发布；截图路径需用清晰中文截图单独验证。

## 目录

```text
src/App.tsx                 看板、日程、管理
src/components/ImportPanel.tsx  文本 / OCR / 草稿交互
src/parser/index.ts         独立规则解析与适配器调度
server/worker.ts            会话、通知、导入、审核 API
server/llm.ts               可选 LLM 适配器
migrations/                D1 迁移
tests/                     解析单测
scripts/                   构建、种子数据、账号初始化与验证
```

## 后续 P1

1. **机器人 webhook**：NapCat / NoneBot / 企业微信适配器，签名验证、重放防护、消息 ID 幂等、群与班级映射；统一进入解析及待审队列。QQ / 微信客户端自动化需单独配置，不在浏览器内抓取群聊。
2. **作业打卡和统计**：增加学生身份与提交记录。当前“已读”按账号同步，不是作业打卡，不能据此统计全班完成率。
3. **订阅提醒**：公开通知 RSS；邮件 / 机器人回推采用调度队列、去重和退订配置。企业微信群机器人通常用于回推，获取群消息需具备相应接收能力。
4. **深色模式**：保留语义化颜色与用户偏好，不改变权限或业务状态。
5. 数据规模增长后增加服务端分页、历史归档查询；MVP 每次列表最多返回 500 条。

## Git 里程碑

- `m1-board`：可运行的基础看板、D1、班委发布管理。
- 后续提交记录文本导入、OCR、部署与验收。每次发布前运行上述构建与测试。

## 账号升级验收

- D1 新增 users、user_sessions、notice_reads，旧会话失效，保留历史通知及管理员记录。
- GET /api/session 返回 user（含 role 与 must_change_password）；POST /api/login 接收 name、student_id、password。
- POST /api/account/password 接收 current_password 与 new_password；成功后注销所有会话。
- GET /api/account/reads 返回本人已读 ID；PUT /api/account/reads/:id 标记已读，DELETE 撤销已读。
- 未登录读取通知返回 401；首次改密前业务接口返回 403；同学调用 /api/admin/* 返回 403。
- 保留 21 条解析/OCR 单元测试，集成测试增加姓名校验、首次改密、旧密码和会话失效、学生权限、已读隔离与跨设备读取。
- 名单及密码不包含在静态网站、Git 或源码包内。初始账号的实际激活和改密由账号本人完成。
- 线上已核验 29 个账号：班委 1 人、同学 28 人，全部要求首次改密。抽测班委与同学的登录后及时退出，未改变用户密码。
- 旧匿名版历史部署已下线（原部署地址返回 404），防止旧 Worker 继续公开读取当前数据库。旧源码仍保存在 Git 历史；不要将匿名版重新部署到此数据库。
