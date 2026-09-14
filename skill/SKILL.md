---
name: mergeguard
description: '智能合并守卫：快照分支+预演+验证式合并+规则衰减防护，解决全球 IDE 分支合并难题。'
---

# MergeGuard

Package version: v7.0.40

当前实现是“规则编译与守门协议”，不是可直接操作 git 的合并器。任何仓库写入、快照、合并或回滚都必须交给真实 local runner；远程纯运行时一律 fail-closed。

## M1–M5 能力状态

| 编号 | 状态 | 当前边界 |
|---|---|---|
| M1 完整 JSON Schema | 已实现 | `capabilities.operationSchemas` 返回结构化 JSON Schema，不返回伪类型字符串 |
| M2 RuleGuard DSL | 已实现（regex） | 版本化 regex 规则、编译校验、显式审计豁免；AST 规则仍规划中 |
| M3 L2 结构合并协议 | 规划中 | AST、JSON 键路径、公式图合并都不得声称已执行 |
| M4 git 映射 | 规划中 / local runner required | 当前无真实仓库、分支、worktree、commit、持久快照或台账 |
| M5 Validator 复用 | 已实现（验签桥） | 可验签 `cli.tax.test-evidence/1.0`；实际 merge/rollback 即使证据有效仍需 local runner |

## 操作能力矩阵

| 类别 | 操作 | 行为 |
|---|---|---|
| 纯操作 | capabilities、help、intake、resolve-propose、ruleguard-compile、ruleguard-scan | 只计算或生成提案，不写仓库 |
| local runner required | branch-create/list/switch、diff-report、preflight、merge-verified、rollback、ledger-query | 返回 `blocked + LOCAL-RUNNER-REQUIRED`，绝不返回 merged/rolled-back |
| planned | L2 AST/JSON/公式图、持久快照、持久台账、真实 git mapping | 仅在 capability matrix 标记，不作为可调用成功能力 |

调用前必须先执行 `capabilities`。调用方必须按 `operationStatus` 判断边界，不能把 operation 名称等同于已经实现。

## RuleGuard regex DSL

规则 schema 为 `mergeguard.ruleguard-rule/1.0`，必须包含：

- 稳定 id、`engine: regex`、pattern、合法 flags；
- P0/P1/P2 severity、message、fix、规则 version；
- 显式 exemptions 数组，即使为空也必须出现。

规则集 schema 为 `mergeguard.ruleguard-ruleset/1.0`，必须声明独立 ruleset version 和 `engine: regex`。`engine: ast` 会确定性返回 `RULEGUARD-AST-PLANNED`，不会偷偷按 regex 执行。

每个豁免必须包含 exemptionId、pathPattern、reason、approvedBy、ticket，可选 expiresAt。命中有效豁免时扫描结果必须返回 `exemptionAudit`，记录规则/规则集版本、文件、批准人、工单和原因；过期豁免不生效。无审计字段的“白名单”禁止使用。

示例：

```json
{
  "schemaVersion": "mergeguard.ruleguard-rule/1.0",
  "id": "no-console",
  "engine": "regex",
  "pattern": "console\\.log\\(",
  "flags": "g",
  "severity": "P1",
  "message": "console.log is forbidden",
  "fix": "Use the audited logger",
  "version": "v1.0.0",
  "exemptions": [{
    "exemptionId": "legacy-console",
    "pathPattern": "^src/legacy\\.ts$",
    "reason": "Temporary migration observability",
    "approvedBy": "security-owner",
    "ticket": "SEC-42",
    "expiresAt": "2026-09-30T00:00:00.000Z"
  }]
}
```

## 合并与回滚的强制边界

远程 runtime 没有仓库文件系统和持久状态，因此：

1. branch 操作不能创建或切换真实分支；
2. preflight 不能声称读取真实 base/ours/theirs；
3. merge-verified 不会修改目标，也不会生成伪 snapshotId；
4. rollback 不会返回 `rolled-back`；
5. ledger-query 不会返回内存伪台账。

local runner 后续实现必须提供仓库 identity、基线 commit、隔离目录、写前不可变快照 receipt、实际 git 命令映射、原子落盘/回滚结果以及持久审计记录。任何一项缺失都要 blocked。

若执行链启用了 ArchGuard，进入 preflight 前必须读取最后一条 checkpoint 台账并核对 contract digest；漂移灯不是 green、台账缺失或摘要不一致时必须 blocked。MergeGuard 不修改架构合同，也不把 ArchGuard 的块级回滚替换成分支合并回滚。

## Validator TestEvidence 桥

`merge-verified.validatorEvidence` 必须是统一 `cli.tax.test-evidence/1.0`：稳定 evidenceId、`kind: test`、`runner: trusted-runner`、command、exitCode、durationMs、summary、subject、subjectDigest 和 Validator execution receipt。subject 必须是包含冻结 GoldenBaseline 的完整 `validator.validation-subject/1.0`，不能用任意对象冒充 Validator 输出。

MergeGuard 使用 `CLITAX_VALIDATOR_RECEIPT_PUBLIC_KEY` 验证 Ed25519 签名，并交叉验证 subject digest、runner、pass、exitCode、duration 和 summary。以下任一情况均 blocked：

- 缺少证据；
- `runner: local` 自报；
- receipt 缺失、签名错误、过期或跨 subject 重放；
- passed 非 true 或 exitCode 非 0。

证据可信只说明验证门通过，不代表仓库已合并。当前仍返回 `LOCAL-RUNNER-REQUIRED`；只有未来真实 runner 完成快照、落盘和复核后才能产生 merged 状态。

## 与技能链的合同

- Aimlock：真实合并前必须先通过 mutate-gate，并把 scope/snapshot receipt 传给 local runner。
- Blueprint：结构合并仍为 planned；当前只能消费冲突上下文生成“不落盘”的 resolution proposal。
- Calctool：公式图节点合并为 planned，不得伪造对账结果。
- Swarm：可派发 local runner 任务，但 worker 自报不能成为 merge 证据。
- Validator：只接受签名 TestEvidence；MergeGuard 不复制或弱化 Validator 的终审规则。

## 受限调用与自动评价闭环

- IDE / 智能体必须通过本包 `invoke` 或 JSON-stdin `broker` 调用，不得直接拼装技能 HTTP 请求，也不得读取 BrainClient token。
- broker 默认读取账号共享凭据文件；显式 `CLITAX_BRAIN_CLIENT_TOKEN_FILE` 使用绝对路径覆盖；macOS/Linux 文件必须为当前 broker 账户所有且权限 `0600`，Windows 文件必须位于受限 `%LOCALAPPDATA%\CLI.Tax\broker` 目录。
- broker 只需要 Brain Client HTTPS、受限身份文件和调用方显式传入的路径，本身不需要完整磁盘访问。若要保证 IDE 无法读取身份文件，必须把 broker 放进独立低权限系统账户或沙箱服务，并只暴露受限 IPC；broker 与 IDE 同账户运行时，`0600` 不能隔离二者，禁止声称令牌已隔离。
- broker 只用 `Authorization: BrainClient …` 发起一次 runtime 请求。HTTP 成功后必须保留响应顶层原始 `feedbackReceiptId`、`feedbackInvocationId` 和 `feedbackEvaluation.digest`，不得生成、猜测、复用或跨调用转移。
- Brain Client 服务端必须严格绑定请求/响应的 `requestId` 和 `schemaVersion`，再根据真实状态、验证结果、服务端耗时与 findings 生成并持久化权威评分、评语和摘要。broker 不得生成分数或评语。
- 同一次 runtime 请求在服务端事务内生成并持久化评价，再返回 `feedbackReceiptId`、`feedbackInvocationId` 和权威摘要；broker 只验证已提交回执，不发起第二次评价写入。`not-reported`、验证不完整、P0/P1 findings、`blocked` 或 `failed` 都不得生成好评。
- 缺少凭证或 ID、身份不匹配、摘要不匹配、响应非法以及任何 HTTP 失败都必须显式失败，不得静默、不重试成重复评价。
- 本地 CLI 不提供手工评分或评语提交命令，人类不得选择技能分数或填写技能评价；日常聊天不属于评价协议。

调用示例：`npx cli-mergeguard@latest invoke <operation> '<JSON对象>'`。IDE 集成可向 `npx cli-mergeguard@latest broker` 的 stdin 发送 `{"operation":"capabilities","input":{}}`。

## 网络中断与原回执恢复

仅在 TLS 握手前确定尚未发送 HTTP 请求时，broker 才允许最多 3 次连接尝试，并受总超时约束。请求发出后发生断线或响应中断，只用 GET 查询原 requestId 的服务端回执，禁止重发 POST；未取得有效回执时保留不确定状态，不得假定成功或继续依赖步骤。

`npx cli-mergeguard@latest recover <operation> <requestId>` 可重新查询原调用，不会重做操作或重复计费。链恢复不会跳过人工确认，也不会自动重跑结果不确定的本地命令。代理连接需 Node.js 22.21+ 或 24.5+；不支持的运行时会明确报错。

## 执行完整性共同规则

1. 工程目标、已接受范围和验收项必须持久化；新增需求先路由与合并，不能覆盖原目标。子任务有明确服务目标的理由，执行仅用本链已匹配技能。每次恢复读取 task-resume，核对剩余项、pending请求和continuationNotifications。
2. 默认由主代理完成工作，禁止为了省事创建子代理、把简单查找/改名/少量修改/单条命令/例行检查/汇总交接给多智能体，禁止为达到门槛拆分或夸大任务。启用Aimlock或Swarm模式不是创建授权，管理/运维/安全/协调是主代理职责，不额外创建常驻智能体。只有业务确需独立且实质性的交付、主代理同时有可推进的独立工作、预期收益严格高于上下文传递/协调/验收成本时才派单；复用已有合适负责人，用户禁止委派时不得创建。每次创建前记录业务理由、交付物、验收项、主代理工作、成本收益、精确路径和原负责人；只创建当前需要的最少数量，不预建空闲角色，不递归扩编或重复扫描。规模门槛200行/3文件/跨模块仅为必要条件，不能单独证明值得委派。主代理负责整合和完整验收，不把半成品当完成；预算抱怨不是停止指令。
3. 自报、回复送达和动作完成不等于工程交付验证。reported始终待验收；Swarm接受工程任务时复用Validator校验签名、有效期、计划/产物/任务绑定。无证据、伪造runner或失败检查不得成为绿色完成。
4. 原任务交接前保存检查点并释放旧锁；回程只发持久通知，宿主消费后重新核验基线、快照与写入权限。历史恢复结果不是新授权。技能不能自行唤醒未接入的IDE。
5. 心跳停止仅允许自动回收尚未开工的assigned任务；claimed/running进入执行结果待核对状态，禁止盲目重复执行。已回传、已验收、失败和取消任务不会被自动重派。服务器停滞回收同时保存会员通知，对话界面定期读取展示。
6. 读取预算、截止和续时确认仅在云端沙箱已开启且本任务实际使用 sandbox 时生效。纯本地或权威响应确认的非沙箱执行，在已授权目标和范围内自动持续，不因旧预算过期、文件数或token额度暂停，也不生成扩展或续时确认；宿主可保留budget-read审计。远端状态未知时只读查询原调用，不推定关闭，不要求扩预算；纯本地无需查询云端。仅实际沙箱内预计长任务在预算初始化后、深读前提出一次精确自动续时策略，真实授权后才自动续时；时间、文件数、token和写入权限分别计量，额度/次数耗尽、撤销和完成保留明确停止规则。读取预算不是付费充值，续时由宿主在读取时触发。
7. 云端沙箱开关按调用会员读取；关闭时仅允许当前受审官方源码摘要在受控worker中直接执行，并记录executionIsolation。预算上下文取同一任务成功runtime响应顶层executionContext，包含cloudSandboxEnabled与executionIsolation；仅true且sandbox启用预算，不用模型自报、调用方参数或旧截图代替真实执行状态。纯本地显式使用{executionIsolation:"local"}；已有预算通过budget-context绑定或更新实际环境，保留原用量、期限和授权。未知或修改过的源码明确要求sandbox，不伪造隔离结果；worker直接执行不是OS沙箱。
8. 使用技能前检查官方发布版本并自动升级可管理的安装副本与客户端；配置失败或升级失败停止并报告。通过configure的JSON标准输入导入一次账号凭据，后续项目/分支/任务共享；密钥不进入源码、URL或命令参数。显式环境覆盖必须是绝对路径。网页复制在点击时获取当前凭据，页面仅展示无密钥地址；已撤销密钥没有权限自动获取新密钥，需已认证网页重新同步一次。

English: keep simple work with the main agent. Delegate only substantial independent business deliverables when benefits exceed coordination costs; use the fewest needed agents, never create idle management agents. Enabling Aimlock does not authorize delegation. Finish all authorized work; a cost complaint is not a stop request. Preserve the original goal; verify execution evidence; resume from durable checkpoints; never replay uncertain side effects. Read budgets and bounded renewal approvals apply only when cloud sandboxing is enabled and actually used for this task. Local or confirmed non-sandbox work continues within its authorized scope without budget prompts; unknown remote state requires a read-only query, never an assumed opt-out or an extension request. Reuse account credentials and check managed skill updates before use; revoked credentials require an authenticated refresh.

Русский: сохраняйте исходную цель, проверяйте доказательства выполнения и возобновляйте работу из сохранённой точки. Не повторяйте операции с неизвестным результатом. Бюджет чтения и ограниченное разрешение на продление действуют только при включённой облачной песочнице, фактически используемой этой задачей. Локальная работа и подтверждённое выполнение без песочницы продолжаются в разрешённых пределах без запросов бюджета; неизвестное удалённое состояние требует запроса только для чтения, а не предположения об отключении или запроса расширения. Ключи учётной записи используются повторно, обновления навыков проверяются перед вызовом.

## 账号共享凭据与自动更新

在已登录的能力市场复制安装入口，将内容粘贴给 IDE。页面只展示原地址，剪贴板会携带当前账号凭据。IDE 将四字段凭据 JSON 经标准输入交给 `npx cli-aimlock@latest configure`；不要放到命令参数、项目文件或日志中。一次配置供同一操作系统账号的所有项目、分支和任务使用，八个技能共享同一文件。

默认位置：macOS 为 `~/Library/Application Support/CLI.Tax/broker/credential.json`，Linux 为 `~/.local/share/CLI.Tax/broker/credential.json`，Windows 为 `%LOCALAPPDATA%\CLI.Tax\broker\credential.json`。显式 `CLITAX_BRAIN_CLIENT_TOKEN_FILE` 仍按绝对路径覆盖默认位置；迁移旧 IDE 配置时移除其过时覆盖，再使用账号共享文件。macOS/Linux 校验当前账号所有权和0600权限；Windows校验仅当前账号与SYSTEM可访问的ACL。

每次新技能调用先查询官方发布版本，精确版本下载并校验身份后自动使用；更新已托管的当前项目与账号技能目录，失败恢复旧目录，禁止覆盖 Git 跟踪源码或未托管内容。升级返回 `upgrade.reloadRequired` 和说明路径时，IDE 应读取更新后的 SKILL.md、核对本任务合同再继续。install/check同样自动更新，不需要每次人工发升级指令。查询不确定调用的原回执不升级、不重发操作。

升级不会清除账号凭据；各调用重新读取共享文件，因此重新同步一次密钥后所有任务使用新值。已撤销或失效的密钥不能为自己取得新权限，必须从已认证网页重新同步一次。两个不同操作系统账号不共享私密文件。

English: configure once using JSON stdin; all tasks under the same OS account reuse the credential. Each new invocation checks and updates the official package and managed documentation. Reload updated instructions when indicated. Revoked keys require a fresh authenticated copy.

Русский: настройте ключ один раз через JSON stdin для всех задач пользователя ОС. Перед новым вызовом пакет и управляемые инструкции обновляются автоматически. Отозванный ключ требует повторной синхронизации с авторизованной страницы.
