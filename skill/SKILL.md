---
name: mergeguard
description: '智能合并守卫：快照分支+预演+验证式合并+规则衰减防护，解决全球 IDE 分支合并难题。'
---

# MergeGuard

Package version: v7.0.31

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
- broker 从 `CLITAX_BRAIN_CLIENT_TOKEN_FILE` 读取身份；macOS/Linux 文件必须为当前 broker 账户所有且权限 `0600`，Windows 文件必须位于受限 `%LOCALAPPDATA%\CLI.Tax\broker` 目录。
- broker 只需要 Brain Client HTTPS、受限身份文件和调用方显式传入的路径，本身不需要完整磁盘访问。若要保证 IDE 无法读取身份文件，必须把 broker 放进独立低权限系统账户或沙箱服务，并只暴露受限 IPC；broker 与 IDE 同账户运行时，`0600` 不能隔离二者，禁止声称令牌已隔离。
- broker 只用 `Authorization: BrainClient …` 发起一次 runtime 请求。HTTP 成功后必须保留响应顶层原始 `feedbackReceiptId`、`feedbackInvocationId` 和 `feedbackEvaluation.digest`，不得生成、猜测、复用或跨调用转移。
- Brain Client 服务端必须严格绑定请求/响应的 `requestId` 和 `schemaVersion`，再根据真实状态、验证结果、服务端耗时与 findings 生成并持久化权威评分、评语和摘要。broker 不得生成分数或评语。
- 同一次 runtime 请求在服务端事务内生成并持久化评价，再返回 `feedbackReceiptId`、`feedbackInvocationId` 和权威摘要；broker 只验证已提交回执，不发起第二次评价写入。`not-reported`、验证不完整、P0/P1 findings、`blocked` 或 `failed` 都不得生成好评。
- 缺少凭证或 ID、身份不匹配、摘要不匹配、响应非法以及任何 HTTP 失败都必须显式失败，不得静默、不重试成重复评价。
- 本地 CLI 不提供手工评分或评语提交命令，人类不得选择技能分数或填写技能评价；日常聊天不属于评价协议。

调用示例：`npx cli-mergeguard@latest invoke <operation> '<JSON对象>'`。IDE 集成可向 `npx cli-mergeguard@latest broker` 的 stdin 发送 `{"operation":"capabilities","input":{}}`。
