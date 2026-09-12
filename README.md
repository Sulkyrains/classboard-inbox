# 知会 · 班级通知看板

React + TypeScript + Cloudflare Pages Functions + D1 的班级通知网站。群消息先解析为草稿，班委审核后才公开。

## 实现范围

- 今日看板、全部通知、分类 / 时间 / 未读筛选、搜索、近期七天日程与倒计时。
- 标题、正文、发布时间、活动时间、截止时间、地点、通知对象、四种分类、置顶、过期和本机已读。
- 班委账号登录、发布、编辑、归档，乐观锁避免并发修改互相覆盖。
- QQ / 微信文本导入，批量草稿、字段修正、原文对照、重复内容跳过。
- 待审核 → 发布 / 驳回。原文与待审内容不会通过游客接口返回。
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

### 创建班委账号

本站不提供默认账号或公开注册入口。

```sh
npm run admin:setup
```

由维护者在 http://127.0.0.1:8790 输入账号、显示名及两次密码。密码至少 12 位。工具只监听本机，创建后自动关闭。不要把真实密码发到聊天或提交到 Git。

工具使用独立随机盐和 PBKDF2-SHA256 派生值，明文不保存、不打印。为调用 D1 CLI，会短暂写入派生值 SQL，成功或失败后删除；`work/` 已排除在 Git 外。会话保存在服务端，Cookie 为 HttpOnly / SameSite=Strict，HTTPS 下附加 Secure；有效期 8 小时。登录失败会限速。

### 撤销某个账号

在受控的 D1 控制台中删除对应 `admins` 行，会级联删除该账号会话。没有自助找回密码；维护者可删除旧账号并使用本机工具重建。请勿导出或分享账号派生值与会话表。

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

然后创建线上班委账号：

```sh
npm run admin:setup -- --remote
```

维护者在本机初始化页完成输入后，回到线上看板登录。若使用本账户以外的 Cloudflare 身份，应先核对目标数据库及 Pages 项目。

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
- 浏览器验收：发布通知 → 游客查看 → 分类筛选 → 导入 → 原文检查 → 审核发布；截图路径需用清晰中文截图单独验证。

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
2. **作业打卡和统计**：增加学生身份与提交记录。当前“已读”只保存在本机，不是实名打卡，不能据此统计全班完成率。
3. **订阅提醒**：公开通知 RSS；邮件 / 机器人回推采用调度队列、去重和退订配置。企业微信群机器人通常用于回推，获取群消息需具备相应接收能力。
4. **深色模式**：保留语义化颜色与用户偏好，不改变权限或业务状态。
5. 数据规模增长后增加服务端分页、历史归档查询；MVP 每次列表最多返回 500 条。

## Git 里程碑

- `m1-board`：可运行的基础看板、D1、班委发布管理。
- 后续提交记录文本导入、OCR、部署与验收。每次发布前运行上述构建与测试。
