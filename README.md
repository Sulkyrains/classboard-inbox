# 知可而办 · 班级通知看板

线上网站：[https://classboard-upc.pages.dev](https://classboard-upc.pages.dev/)。2026-09-13 已上线账号升级，连接 Cloudflare Pages 和远程 D1，提供 6 条示例通知。全站通知须登录并完成首次改密后才能查看。2026-09-24 上线班委职位与权限分级：7 位班委带职位，通知显示发布人，班长 / 团支书权限高于其他委员。同日发布前全量测试顺带补上两处入口：顶栏职位标签可直接打开个人账号，侧边栏「我们的班级」回到今日看板。

交付验证：65 条单元测试、类型检查、构建和接口集成测试通过；本地浏览器（DOM 走查）确认首次改密门禁、个人设置入口、顶栏职位标签与侧边栏「我们的班级」两处新入口、班委与同学两种身份及 390px 窄屏无横向溢出；线上端到端用临时账号与直插通知复验发布人展示、委员越权 403、团支书归档后全班看板消失，跑完清理干净。可运行 `node scripts/verify-live.mjs` 复查线上匿名访问隔离。OCR 实际样例识别在上一版本验收，本次识别逻辑未更改。可选 LLM 未配置真实服务，默认使用规则解析；班委登录后从“群消息导入”进入草稿与审核流程。

React + TypeScript + Cloudflare Pages Functions + D1 的班级通知网站。群消息先解析为草稿，班委审核后才公开。

## 实现范围

- 今日看板、全部通知、分类 / 时间 / 未读筛选、搜索、近期七天日程与倒计时。
- 标题、正文、发布时间、活动时间、截止时间、地点、通知对象、四种分类、置顶、过期和个人已读同步。
- 班委账号登录、发布、编辑、归档，乐观锁避免并发修改互相覆盖；通知卡片与详情显示发布人「职位 + 姓名」，班长 / 团支书权限高于其他委员。
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

新版使用姓名、学号、密码登录，角色为 committee / student。首次登录必须先修改密码，新密码至少 6 位，且不能是学号、连续或重复数字以及常见弱口令。旧 admins 记录保留但不再参与登录；没有公开注册入口。

**每人一份独立的随机初始密码。** 姓名和学号在班里是公开信息，如果全班共用一个初始密码，任何知道它的人都能抢在本人之前登录任意账号（包括班委账号）并改掉密码。导入工具因此为每个人单独生成一个 10 位随机密码（去掉 `0/O/1/l/I` 等易混字符），写入 `work/initial-passwords.csv`（权限 0600，`work/` 已被 Git 忽略），控制台只打印统计数字。**请逐人当面或私聊发放，发完删除该文件；不要发到群里。**

先执行数据库迁移，然后在 Git 忽略目录 `work/` 准备 JSON 数组，每项包含 `name` 和字符串类型的 `student_id`。本次 29 人、两列无标题的原始 Excel 可用以下脚本提取（其他格式请先整理为 JSON）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/read-roster.ps1 -Workbook "你的名单.xlsx"
```

运行 `node scripts/accounts.mjs --roster work/roster.json --committee "班委姓名"`，线上加 `--remote`。批量导入不需要输入任何密码；推荐使用下面的本机工具：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-accounts.ps1 -Roster work/roster.json -Committee "班委姓名"
# 线上加 -Remote
# 重置单个账号：-Reset "学号" -Remote（提示符留空则自动生成随机临时密码并打印）
# 查看激活进度：-Status -Remote
```

未激活（`must_change_password=1`）的账号，其初始密码仍然有效，是整套系统里唯一还能被冒用的窗口。用 `-Status` 随时查看谁还没登录改密，并优先让班委账号第一个激活：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-accounts.ps1 -Status -Remote
```

**从旧的共享初始密码迁移。** 早期版本给全班发的是同一个初始密码。`-Reissue` 会给所有还没激活的账号各换一份新的独立随机密码、撤销其现有会话，并写出同一份 `work/initial-passwords.csv`；已经自己改过密码的账号不受影响。导入流程只新建缺失的账号、不会覆盖已有账号的密码，所以旧账号必须走这一步：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-accounts.ps1 -Reissue -Remote
```

导入校验空字段、重复学号、班委唯一性及现有账号姓名/角色冲突；重复执行跳过已有账号，不覆盖密码。每人使用独立随机密码、独立随机盐和 PBKDF2-SHA256 摘要。临时 SQL 自动删除；名单、密码与派生值不进入 Git 或静态资源。

### 忘记密码

维护者使用上述本机工具的 `-Reset "学号"` 参数。密码提示符留空即自动生成一个随机临时密码并打印出来（也可自己输入 8—256 位）。工具撤销此人的所有会话并重新要求首次改密。无需删除重建账号，个人已读记录保留。旧 `admin:setup` 流程已停用。

### 班委职位与权限分级

职位存在 `users.position`（`migrations/0008_positions.sql` 只负责建列）。**具体谁是什么职位属于名单信息，不写进 Git**：映射放在本地 `work/positions.json`（`work/` 已被忽略），用账号工具写入：

```powershell
# work/positions.json：[{"student_id":"…","position":"班长"}, …]，学号必须在账号表里存在
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-accounts.ps1 -Positions work/positions.json
# 线上加 -Remote
```

工具会把这些账号的角色一并设为班委、写入职位，并让客户端缓存失效；用 `-Status` 可以按人查看当前职位。现有职位类型：班长、团支书、学习委员、心理委员、文体委员、生活委员。

- 公开列表、公开详情和班委管理列表都带发布人「职位 + 姓名」，职位是实时 JOIN 当前账号得到的，同学能看见是谁发的。
- 权限规则集中在 `src/shared/roles.ts`：**班长、团支书不受限制**，可以归档、编辑（含置顶）任何通知；**其他委员不能归档、也不能编辑班长或团支书发布的通知**，其余情况（自己发布的通知、委员之间）不受限。前端把受限的按钮置灰并说明原因，服务端同样返回 403。
- 任何班委发布通知都直接公开、无需审核；「待审核 → 发布 / 驳回」只用于群消息导入生成的草稿。
- 归档即通知从所有人（含同学）的看板消失，只在班委「通知管理 → 已归档」中可查；没有面向同学的个人归档页。
- 调整职位后要执行 `UPDATE notice_feed SET version=version+1 WHERE id=1;`，否则客户端 ETag 未变，会继续用缓存里的旧职位显示（`--positions` 已包含这一步）。
- 2026-09-24 线上核验（临时账号 + 一条 SQL 插入的测试通知，验证后已清理，库回到 29 人 / 0 通知）：同学端能看到发布人；学习委员编辑、归档团支书发布的通知均返回 403；团支书归档返回 200；归档后所有人（含同学）的看板都不再显示该通知，详情返回 404，管理页仍显示「已归档」。

会话 Cookie 使用 HttpOnly、SameSite=Strict 和 HTTPS Secure，有效期 30 天——安卓 App 要靠这个会话在后台轮询新通知，会话太短会让提醒停掉。登录、修改密码与测试推送失败会限速。退出登录或修改密码时会一并清除离线缓存，避免共用设备上被下一个人离线读到。首次改密后为当前设备签发新会话并直接进入看板；之后在个人设置中改密仍要求重新登录，其他旧会话均失效。

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

D1 数据库仍叫 `classboard-inbox`，Pages 项目名为 `classboard-upc`（网站域名 classboard-upc.pages.dev，2026-09 由 classboard-inbox 更名；旧 Pages 项目保留过渡）。配置中现有数据库 ID 对应本次创建的数据库；部署到其他账户时，应替换为自己创建的 D1 ID，不要沿用。

首次使用 Wrangler 时，由维护者自行在浏览器完成官方登录授权：

```sh
npx wrangler login
```

新账户首次创建资源（已存在则跳过）：

```sh
npx wrangler d1 create classboard-inbox
npx wrangler pages project create classboard-upc --production-branch main
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

然后按上文运行账号导入工具，加上 `--remote` 写入线上数据库。用户以姓名、学号和初始密码登录，首次改密后直接进入看板。部署前应核对目标数据库及 Pages 项目。

`scripts/package-connector.mjs` 另提供 API 直接上传打包形式，供有 Cloudflare API 连接的环境使用。该变体把应用小文件嵌入 Worker，OCR 引擎通过固定版本 CDN 路径代理；全部请求会计入 Functions 额度。它不参与常规 `npm run deploy`，日常维护优先用上面的标准静态部署方式。

### 免费额度与通知列表缓存

Pages 静态请求、Functions 与 D1 的免费额度按 Cloudflare 当前账户计划执行，不代表无限用量。参考 [Pages 计费](https://developers.cloudflare.com/pages/functions/pricing/) 和 [D1 计费](https://developers.cloudflare.com/d1/platform/pricing/)。

**D1 按查询扫描的行数计费**，而前端每 30 秒轮询一次通知列表，安卓 App 另有每 15 分钟一次的后台轮询。早期实现每次轮询都要扫过整张 `notices` 表，行读取量随「人数 × 在线时长 × 通知条数」线性增长，很快会顶到免费额度的 500 万行/天。

现在 `/api/notices` 与 `/api/admin/notices` 走 ETag 校验：`notice_feed` 表里存一个版本号，通知有任何增删改时在同一个事务里 +1；请求先读这一行算出 ETag，与 `If-None-Match` 一致就直接回 304，不再查通知表。浏览器自动完成整个校验流程，前端代码无需改动。响应头用 `private, no-cache`——`no-cache` 表示每次都回来校验，所以新通知不会延迟；`private` 保证 CDN 和中间代理不留副本。

实测（库中 300 条已发布、800 条总计）：

| 接口 | 改前 | 改后 |
|---|---:|---:|
| `/api/notices` | 300 行 | 1 行 |
| `/api/admin/notices`（补 `created_at` 索引前） | 1600 行 | 1 行 |
| `/api/admin/notices`（补索引后，缓存未命中时） | 500 行 | — |

29 人日均 2 小时的场景下，行读取量从约 306 万/天（免费额度的 61%）降到约 3 万/天（0.6%）；即便扩到 200 人也只占 4%。

**部署顺序：先跑迁移，再部署 Worker。** 迁移未执行时读取端会自动退回不做缓存校验（不会 500），但发布通知的事务里包含版本号自增，缺表会导致发布失败。

## 测试与验收

```sh
npm test
npm run build
npm run test:integration
```

`test:integration` 使用隔离的 Miniflare D1 和每次随机生成的测试身份，不连接线上数据库，不输出账号凭据。构建失败时不要继续使用旧 `dist` 做验收。

- 解析单测覆盖典型群消息、相对时间、半点、跨年、无效日期、多草稿、变更提醒及 LLM 异常 / 超时 / 坏结构回退。
- 集成验证覆盖真实 Worker 路由：登录、来源校验、游客权限、发布、筛选、置顶、乐观锁、待审内容不可见、审核、归档、精确去重、退出，以及班委职位显示与归档 / 编辑权限分级（委员越权返回 403）。
- 浏览器验收：发布通知 → 同学登录查看 → 分类筛选 → 导入 → 原文检查 → 审核发布；截图路径需用清晰中文截图单独验证。
- 发布前全量测试（2026-09-24）：`npm test` 65 条 → `npm run typecheck` → `npm run build` → `npm run test:integration` → 本地 DOM 走查 → 线上迁移核查 → 两个 Pages 项目部署同一份 dist → 线上端到端（临时账号 + SQL 直插通知，不触发推送，用完即清）→ 安装包链路（本地与线上 `classboard.apk` sha256 一致、`app-version.json` 与 `android-app/app/build.gradle` 同为 versionCode 12 / 2.3.2、两个域名均 no-cache）。

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
- POST /api/account/password 接收 current_password 与 new_password；成功后注销旧会话；首次改密返回新会话与 user，直接进入系统。
- GET /api/account/reads 返回本人已读 ID；PUT /api/account/reads/:id 标记已读，DELETE 撤销已读。
- 未登录读取通知返回 401；首次改密前业务接口返回 403；同学调用 /api/admin/* 返回 403。
- 保留 21 条解析/OCR 单元测试，集成测试增加姓名校验、首次改密、旧密码和会话失效、学生权限、已读隔离与跨设备读取。
- 名单及密码不包含在静态网站、Git 或源码包内。初始账号的实际激活和改密由账号本人完成。
- 线上已核验 29 个账号：班委 7 人（班长、团支书各 1 人，学习 / 文体 / 生活委员各 1 人，心理委员 2 人）、同学 22 人，全部要求首次改密。抽测班委与同学的登录后及时退出，未改变用户密码。
- 旧匿名版历史部署已下线（原部署地址返回 404），防止旧 Worker 继续公开读取当前数据库。旧源码仍保存在 Git 历史；不要将匿名版重新部署到此数据库。

本次体验优化：已读通知卡片使用淡灰背景和较淡文字，未读通知右上角显示“未读”角标；标记状态继续按账号同步。登录输入框只保留外部标签，去除占位文字。首次改密测试覆盖 5 位拒绝、6 位接受、会话轮换及无需重复登录即可读取通知。

## 手机应用（PWA）

访问 [知可而办](https://classboard-upc.pages.dev/)，在登录页或个人账号窗口点击「添加到手机桌面」。支持安装的浏览器会弹出安装提示，其余浏览器会显示安装步骤。

- 安卓：使用 Chrome 或 Edge，浏览器菜单 →「安装应用」或「添加到主屏幕」。
- iPhone：使用 Safari，分享 →「添加到主屏幕」，之后从桌面「知可而办」图标打开。
- 安装后以独立窗口运行，沿用网站的姓名、学号和密码；首次改密后直接进入看板。不同浏览器与桌面应用可能需要各自登录。
- 联网重新打开时获取最新网页；已打开的应用检测到新版本后显示「刷新更新」，用户保存草稿后再刷新。无需重新下载安装包。
- 通知始终从服务器读取，Service Worker 只缓存通用离线提示页，不缓存账号、通知或导入原文；离线时提示重新连接。

安装行为以设备浏览器支持为准，参考 [MDN 安装说明](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing)。本次交付为可安装 PWA，不生成 APK 或提交应用商店。

`npm run build` 自动生成带版本标识的 Service Worker。应用图标已包含在源码中，常规构建无需 Python；如需重新生成图标，可用带 Pillow 的 Python 运行 `scripts/create-app-icons.py`。保持 `/sw.js` 的 no-cache 响应头和首页的 no-store 响应头，避免长期停留在旧版。

### 卡片交互与计数

点击通知卡片空白处、标题或内容均可打开详情；键盘聚焦卡片后可按 Enter / 空格打开。标记已读和班委操作按钮不会误触详情。顶栏右上角职位标签与侧边栏「我们的班级」都可点击：前者打开个人账号设置，后者回到今日看板并重置搜索与筛选。

「全部通知」数字统计全体已发布通知中的个人未读数；「通知列表」数字统计当前筛选结果中的未读数。已读卡片仍可查看，今日通知总数与班委管理计数保留原有含义。

验证包括 25 条单元测试（含 4 条 PWA 清单、图标、离线回退与私有接口不缓存测试）、接口集成测试，以及浏览器卡片点击、已读按钮独立操作、角标由 1 → 0 → 1 的交互测试。手机实机安装仍需用户在自己的设备上完成。

## 新通知推送（Web Push）与日程订阅

2026-09-14 新增功能：手机推送、iCal 日程订阅、深色模式、截止时间倒计时高亮、通知正文 Markdown 渲染。

### 手机推送（Web Push）

- 用户在「个人账号」窗口点击「开启新通知推送」，授权后设备会收到新通知的锁屏推送；可发送测试推送验证，也可随时关闭。
- 安卓 Chrome/Edge 直接支持；iPhone/iPad 需先「添加到主屏幕」，从桌面打开后再开启推送。
- 服务端使用 VAPID + aes128gcm 加密（RFC 8291/8292），仅用 Web Crypto 实现，无新增运行时依赖；推送内容只有通知分类、标题与正文摘要。
- 部署前需配置密钥：
  1. `node scripts/generate-vapid.mjs` 生成一对密钥（只生成一次，妥善保存）。
  2. 本地开发：写入 `.dev.vars`（已被 .gitignore 排除）。
  3. 线上：`npx wrangler pages secret put VAPID_PUBLIC_KEY`、`npx wrangler pages secret put VAPID_PRIVATE_KEY`，再可配置 `VAPID_SUBJECT`（mailto: 联系方式，可省略）。
  4. 首次部署需应用数据库迁移：`npx wrangler d1 migrations apply classboard-inbox --remote`（新增 0004 推送订阅表、0005 日历令牌列、0008 班委职位列并初始化 7 位班委）。
- 未配置密钥时推送相关接口返回 503，网站其余功能不受影响；已失效的推送订阅会在发送后自动清理。

### 日程订阅（iCal）

- 「个人账号」窗口点击「订阅班级日程到手机日历」复制订阅链接，在手机日历 App 中「订阅日历」粘贴即可；日程随通知发布自动更新。
- 订阅链接含个人令牌（64 位十六进制），仅暴露带活动/截止时间的已发布通知，不包含已读等私有数据；请勿公开分享链接。

### 深色模式

- 顶栏月亮/太阳按钮切换，首次访问跟随系统设置，选择会保存在本机。

### Markdown 与截止提醒

- 通知正文支持 Markdown（标题、列表、链接、代码等），经 DOMPurify 消毒后渲染；链接自动在新标签页打开。
- 带「截止时间」的通知卡片显示倒计时徽章：24 小时内红色、72 小时内橙色。

### 安装与分发指引

- 网站「个人账号」弹窗和登录页内置分平台安装指引：微信/QQ 内置浏览器会提示「用系统浏览器打开」；iPhone Safari 按步骤「分享 → 添加到主屏幕」；安卓 Chrome 收推送无需安装，安装桌面图标走菜单「安装应用」。
- 安卓 App（`android-app/`，原生 Activity + WebView 壳，无 AndroidX、不依赖谷歌服务）：
  1. **直接分发**：安装包随网站发布，手机浏览器打开 `https://classboard-upc.pages.dev/classboard.apk` 下载安装（允许「未知来源」即可）；也可把该链接/APK 文件发到班级群。
  2. App 每约 15 分钟在后台轮询一次通知接口，有新通知即弹系统通知，因此不依赖 FCM / GMS；App 在前台时新通知立即弹出，登录状态保留 30 天。
  3. **自动更新**：启动时与后台轮询时读取 `public/app-version.json`，发现更高 `versionCode` 就自动把安装包下载到应用私有目录，校验包名、版本号、签名与当前 App 一致后，应用内弹「立即安装」或发一条「已下载」通知，点按即拉起系统安装器，全程不用浏览器；「个人账号」弹窗内也有「检查 App 更新」入口。校验不通过的安装包会被直接丢弃。
  4. **边到边留白**：Android 15 起系统强制边到边绘制，App 按系统 insets 给页面留出状态栏 / 导航栏空间，并随网页深浅色切换留白区底色与状态栏图标明暗，顶部不会再被状态栏压住。
  5. 重新打包：在 `android-app/` 下执行 `sh gradlew assembleRelease`（需 JDK17 与 Android SDK，SDK 路径写在本地 `local.properties`），再 `zipalign -p 4`、`apksigner sign` 后覆盖 `public/classboard.apk`。签名密钥 `android/android.keystore` 与密码仅本地保管，勿外传、勿入库。
  6. 发版时同步提升 `android-app/app/build.gradle` 的 `versionCode` 与 `public/app-version.json`，已装旧版会自动下载并提示安装；换签名密钥还需同步更新 `public/.well-known/assetlinks.json` 的 SHA-256 指纹并重新部署。
- iPhone 无 Apple 开发者账号暂不打包，使用 Safari「添加到主屏幕」方案（功能与 APK 一致：独立窗口 + 推送）。

验证：typecheck、27 条单元测试（新增 Web Push 加密往返与失效端点清理测试）、本地 wrangler pages dev 走查（登录、发布 Markdown 通知、倒计时徽章、深色切换、ICS 输出、推送订阅校验）。真机推送需完成上述密钥配置后在自己的手机上验证。
