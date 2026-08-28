import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

const REQ = "mergeguard.skill.request/1.0";
const RES = "mergeguard.skill.response/1.0";
const ERR = "mergeguard.skill.error/1.0";
const NAME = "mergeguard";
const COMPILER_VERSION = "v7.0.28";
const CATALOG_SCHEMA = "cli.tax.skill-catalog/1.0";
const RULE_SCHEMA = "mergeguard.ruleguard-rule/1.0";
const RULESET_SCHEMA = "mergeguard.ruleguard-ruleset/1.0";
const TEST_EVIDENCE_SCHEMA = "cli.tax.test-evidence/1.0";
const RECEIPT_SCHEMA = "validator.execution-receipt/1.0";
const VALIDATION_SUBJECT_SCHEMA = "validator.validation-subject/1.0";
const GOLDEN_BASELINE_SCHEMA = "validator.golden-baseline/1.0";
const RECEIPT_PUBLIC_KEY_ENV = "CLITAX_VALIDATOR_RECEIPT_PUBLIC_KEY";
const SHA_PATTERN = "^[0-9a-f]{64}$";
const ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$";
const idRegex = new RegExp(ID_PATTERN);
const shaRegex = new RegExp(SHA_PATTERN);

const OPS = ["capabilities","help","intake","branch-create","branch-list","branch-switch","diff-report","preflight","resolve-propose","merge-verified","rollback","ledger-query","ruleguard-scan","ruleguard-compile"];
const PURE = new Set(["capabilities","help","intake","resolve-propose","ruleguard-scan","ruleguard-compile"]);
const LOCAL_RUNNER_REQUIRED = new Set(["branch-create","branch-list","branch-switch","diff-report","preflight","merge-verified","rollback","ledger-query"]);
const PLANNED = ["L2-AST-merge", "JSON-keypath-merge", "formula-graph-merge", "persistent-snapshots", "persistent-ledger", "real-git-mapping"];
const CATALOG = OPS.map((operation) => ({ operation, summary: operation }));

const stringSchema = (extra = {}) => ({ type: "string", ...extra });
const arraySchema = (items, extra = {}) => ({ type: "array", items, ...extra });
const objectSchema = (properties, required = [], extra = {}) => ({ type: "object", properties, required, additionalProperties: false, ...extra });
const anyObjectSchema = { type: "object" };
const findingSchema = objectSchema({ severity: { enum: ["P0", "P1", "P2"] }, ruleId: stringSchema(),
  entityRef: stringSchema(), message: stringSchema(), evidence: anyObjectSchema },
 ["severity", "ruleId", "entityRef", "message", "evidence"]);
const fileSchema = objectSchema({ path: stringSchema({ minLength: 1 }), content: stringSchema() }, ["path", "content"]);
const exemptionSchema = objectSchema({ exemptionId: stringSchema({ pattern: ID_PATTERN }), pathPattern: stringSchema({ minLength: 1, maxLength: 512 }),
  reason: stringSchema({ minLength: 1 }), approvedBy: stringSchema({ pattern: ID_PATTERN }),
  ticket: stringSchema({ minLength: 1 }), expiresAt: stringSchema({ format: "date-time" }) },
 ["exemptionId", "pathPattern", "reason", "approvedBy", "ticket"]);
const ruleSchema = objectSchema({ schemaVersion: { const: RULE_SCHEMA }, id: stringSchema({ pattern: ID_PATTERN }),
  engine: { const: "regex" }, pattern: stringSchema({ minLength: 1, maxLength: 512 }), flags: stringSchema({ pattern: "^[gimsuy]*$" }),
  severity: { enum: ["P0", "P1", "P2"] }, message: stringSchema({ minLength: 1 }),
  fix: stringSchema({ minLength: 1 }), version: stringSchema({ pattern: ID_PATTERN }), exemptions: arraySchema(exemptionSchema) },
 ["schemaVersion", "id", "engine", "pattern", "flags", "severity", "message", "fix", "version", "exemptions"]);
const rulesetSchema = objectSchema({ schemaVersion: { const: RULESET_SCHEMA }, version: stringSchema({ pattern: ID_PATTERN }),
  engine: { const: "regex" }, rules: arraySchema(ruleSchema, { minItems: 1 }) }, ["schemaVersion", "version", "engine", "rules"]);
const goldenBaselineSchema = objectSchema({ schemaVersion: { const: GOLDEN_BASELINE_SCHEMA }, baselineId: stringSchema({ pattern: ID_PATTERN }),
  source: objectSchema({ kind: { enum: ["repository-commit", "artifact", "approved-record"] }, locator: stringSchema({ minLength: 1 }),
    digestSha256: stringSchema({ pattern: SHA_PATTERN }) }, ["kind", "locator", "digestSha256"]), version: stringSchema({ pattern: ID_PATTERN }),
  frozen: { const: true }, frozenAt: stringSchema({ format: "date-time" }), frozenBy: stringSchema({ pattern: ID_PATTERN }),
  testsSha256: stringSchema({ pattern: SHA_PATTERN }) }, ["schemaVersion", "baselineId", "source", "version", "frozen", "frozenAt", "frozenBy", "testsSha256"]);
const validatorSubjectSchema = objectSchema({ schemaVersion: { const: VALIDATION_SUBJECT_SCHEMA }, artifactSha256: stringSchema({ pattern: SHA_PATTERN }),
  validationRunId: stringSchema({ pattern: ID_PATTERN }), planId: stringSchema({ pattern: ID_PATTERN }),
  tests: arraySchema(anyObjectSchema, { minItems: 1 }), policy: objectSchema({ command: stringSchema({ minLength: 1 }),
    requiredExitCode: { const: 0 } }, ["command", "requiredExitCode"]), goldenBaseline: goldenBaselineSchema,
  contracts: anyObjectSchema }, ["schemaVersion", "artifactSha256", "validationRunId", "planId", "tests", "policy", "goldenBaseline"]);
const receiptResultSchema = objectSchema({ runner: { const: "trusted-runner" }, passed: { const: true }, exitCode: { const: 0 },
  durationMs: { type: "number", minimum: 0 }, summary: stringSchema({ minLength: 1 }) }, ["runner", "passed", "exitCode", "durationMs", "summary"]);
const receiptSchema = objectSchema({ schemaVersion: { const: RECEIPT_SCHEMA }, keyId: stringSchema({ pattern: SHA_PATTERN }),
  subjectDigest: stringSchema({ pattern: SHA_PATTERN }), nonce: stringSchema({ minLength: 1 }), issuedAt: stringSchema({ format: "date-time" }),
  expiresAt: stringSchema({ format: "date-time" }), result: receiptResultSchema, signature: stringSchema({ minLength: 1 }) },
 ["schemaVersion", "keyId", "subjectDigest", "nonce", "issuedAt", "expiresAt", "result", "signature"]);
const testEvidenceSchema = objectSchema({ schemaVersion: { const: TEST_EVIDENCE_SCHEMA }, evidenceId: stringSchema({ pattern: ID_PATTERN }),
  kind: { enum: ["test", "build", "lint", "security", "benchmark"] }, runner: { enum: ["local", "trusted-runner"] },
  command: stringSchema({ minLength: 1 }), exitCode: { type: "integer" }, durationMs: { type: "number", minimum: 0 },
  summary: stringSchema({ minLength: 1 }), artifactSha256: stringSchema({ pattern: SHA_PATTERN }), subject: anyObjectSchema,
  subjectDigest: stringSchema({ pattern: SHA_PATTERN }), receipt: receiptSchema },
 ["schemaVersion", "evidenceId", "kind", "runner", "command", "exitCode", "durationMs", "summary"]);
const validatorEvidenceSchema = objectSchema({ ...testEvidenceSchema.properties, kind: { const: "test" },
  runner: { const: "trusted-runner" }, exitCode: { const: 0 }, subject: validatorSubjectSchema },
 ["schemaVersion", "evidenceId", "kind", "runner", "command", "exitCode", "durationMs", "summary", "artifactSha256", "subject", "subjectDigest", "receipt"]);
const nextSchema = objectSchema({ operation: { type: ["string", "null"] }, instruction: stringSchema() }, ["operation", "instruction"]);
const responseSchema = (properties, required) => objectSchema({ schemaVersion: { const: RES }, requestId: stringSchema(),
  status: { enum: ["succeeded", "blocked", "failed"] }, ...properties }, ["schemaVersion", "requestId", "status", ...required]);
const operationSchema = (input, required, output, outputRequired) => ({ input: objectSchema(input, required), output: responseSchema(output, outputRequired) });
const SCHEMAS = Object.freeze({
  capabilities: operationSchema({}, [], { capabilities: anyObjectSchema, operationSchemas: anyObjectSchema, skill: anyObjectSchema, nextStep: nextSchema }, ["capabilities", "operationSchemas", "skill", "nextStep"]),
  help: operationSchema({}, [], { help: anyObjectSchema, operationSchemas: anyObjectSchema, nextStep: nextSchema }, ["help", "operationSchemas", "nextStep"]),
  intake: operationSchema({ repoType: { enum: ["git", "none", "snapshot"] }, riskLevel: { enum: ["low", "medium", "high"] }, baselineRef: stringSchema({ minLength: 1 }) }, ["repoType", "riskLevel", "baselineRef"], { intake: anyObjectSchema, nextStep: nextSchema }, ["intake", "nextStep"]),
  "branch-create": operationSchema({ name: stringSchema({ minLength: 1 }), fromRef: stringSchema({ minLength: 1 }), description: stringSchema() }, ["name", "fromRef"], { localRunnerRequirement: anyObjectSchema, nextStep: nextSchema }, ["localRunnerRequirement", "nextStep"]),
  "branch-list": operationSchema({}, [], { localRunnerRequirement: anyObjectSchema, nextStep: nextSchema }, ["localRunnerRequirement", "nextStep"]),
  "branch-switch": operationSchema({ branchName: stringSchema({ minLength: 1 }) }, ["branchName"], { localRunnerRequirement: anyObjectSchema, nextStep: nextSchema }, ["localRunnerRequirement", "nextStep"]),
  "diff-report": operationSchema({ fromRef: stringSchema({ minLength: 1 }), toRef: stringSchema({ minLength: 1 }), mode: { enum: ["text"] } }, ["fromRef", "toRef", "mode"], { localRunnerRequirement: anyObjectSchema, nextStep: nextSchema }, ["localRunnerRequirement", "nextStep"]),
  preflight: operationSchema({ sourceRef: stringSchema({ minLength: 1 }), targetRef: stringSchema({ minLength: 1 }), evidence: arraySchema(testEvidenceSchema) }, ["sourceRef", "targetRef"], { localRunnerRequirement: anyObjectSchema, nextStep: nextSchema }, ["localRunnerRequirement", "nextStep"]),
  "resolve-propose": operationSchema({ conflictId: stringSchema({ pattern: ID_PATTERN }), strategy: { enum: ["keep-source", "keep-target", "ai-merge"] }, context: stringSchema({ minLength: 1 }) }, ["conflictId", "strategy", "context"], { resolution: anyObjectSchema, nextStep: nextSchema }, ["resolution", "nextStep"]),
  "merge-verified": operationSchema({ sourceRef: stringSchema({ minLength: 1 }), targetRef: stringSchema({ minLength: 1 }), validatorEvidence: arraySchema(validatorEvidenceSchema, { minItems: 1 }), snapshotReceipt: anyObjectSchema }, ["sourceRef", "targetRef", "validatorEvidence", "snapshotReceipt"], { localRunnerRequirement: anyObjectSchema, nextStep: nextSchema }, ["localRunnerRequirement", "nextStep"]),
  rollback: operationSchema({ targetRef: stringSchema({ minLength: 1 }), snapshotReceipt: anyObjectSchema, validatorEvidence: arraySchema(testEvidenceSchema) }, ["targetRef", "snapshotReceipt"], { localRunnerRequirement: anyObjectSchema, nextStep: nextSchema }, ["localRunnerRequirement", "nextStep"]),
  "ledger-query": operationSchema({ repositoryId: stringSchema({ minLength: 1 }), operation: stringSchema(), limit: { type: "integer", minimum: 1, maximum: 500 } }, ["repositoryId", "limit"], { localRunnerRequirement: anyObjectSchema, nextStep: nextSchema }, ["localRunnerRequirement", "nextStep"]),
  "ruleguard-scan": operationSchema({ files: arraySchema(fileSchema, { minItems: 1 }), ruleset: rulesetSchema }, ["files", "ruleset"], { findings: arraySchema(findingSchema), violations: anyObjectSchema, exemptionAudit: arraySchema(anyObjectSchema), totalViolations: { type: "integer" }, nextStep: nextSchema }, ["findings", "violations", "exemptionAudit", "totalViolations", "nextStep"]),
  "ruleguard-compile": operationSchema({ version: stringSchema({ pattern: ID_PATTERN }), rules: arraySchema(ruleSchema, { minItems: 1 }) }, ["version", "rules"], { ruleset: rulesetSchema, nextStep: nextSchema }, ["ruleset", "nextStep"]),
});

function text(value) { return String(value ?? ""); }
function isObj(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function finding(severity, ruleId, entityRef, message, evidence) { return { severity, ruleId, entityRef, message, evidence: evidence === undefined ? {} : { example: evidence } }; }
function ok(requestId, payload) { return { schemaVersion: RES, requestId, status: "succeeded", ...payload }; }
function blocked(requestId, findings) { return { schemaVersion: RES, requestId, status: "blocked", validation: { valid: false, guarantee: "blocked", findings } }; }
function failed(requestId, code, message) { return { schemaVersion: RES, requestId, status: "failed", errorSchema: ERR, error: { code, message } }; }
function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Evidence must contain finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isObj(value)) throw new TypeError("Value must be JSON serializable");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function receiptPayload(receipt) { const { signature: _signature, ...payload } = receipt; return canonicalJson(payload); }
function configuredReceiptKey() {
  const encoded = text(process.env[RECEIPT_PUBLIC_KEY_ENV]).trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  try {
    const der = Buffer.from(encoded, "base64");
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    return key.asymmetricKeyType === "ed25519" ? { key, keyId: createHash("sha256").update(der).digest("hex") } : null;
  } catch { return null; }
}
function trustedValidatorSubject(subject) {
  if (!isObj(subject) || subject.schemaVersion !== VALIDATION_SUBJECT_SCHEMA
    || !shaRegex.test(text(subject.artifactSha256)) || !idRegex.test(text(subject.validationRunId))
    || !idRegex.test(text(subject.planId)) || !Array.isArray(subject.tests) || subject.tests.length === 0
    || !isObj(subject.policy) || !text(subject.policy.command).trim()
    || subject.policy.requiredExitCode !== 0) return false;
  const baseline = subject.goldenBaseline;
  if (!isObj(baseline) || baseline.schemaVersion !== GOLDEN_BASELINE_SCHEMA || baseline.frozen !== true
    || !idRegex.test(text(baseline.baselineId)) || !idRegex.test(text(baseline.version))
    || !idRegex.test(text(baseline.frozenBy)) || !Number.isFinite(Date.parse(text(baseline.frozenAt)))
    || !isObj(baseline.source) || !["repository-commit", "artifact", "approved-record"].includes(baseline.source.kind)
    || !text(baseline.source.locator).trim() || !shaRegex.test(text(baseline.source.digestSha256))) return false;
  return baseline.testsSha256 === createHash("sha256").update(canonicalJson(subject.tests)).digest("hex");
}
function trustedValidatorEvidence(evidence) {
  try {
    const configured = configuredReceiptKey();
    if (!configured || !isObj(evidence) || evidence.schemaVersion !== TEST_EVIDENCE_SCHEMA
      || evidence.kind !== "test" || evidence.runner !== "trusted-runner" || !idRegex.test(text(evidence.evidenceId))
      || !text(evidence.command).trim() || !Number.isInteger(evidence.exitCode)
      || typeof evidence.durationMs !== "number" || !Number.isFinite(evidence.durationMs)
      || evidence.durationMs < 0 || !text(evidence.summary).trim()
      || !shaRegex.test(text(evidence.subjectDigest)) || !trustedValidatorSubject(evidence.subject)
      || evidence.command !== evidence.subject.policy.command || evidence.exitCode !== evidence.subject.policy.requiredExitCode
      || evidence.artifactSha256 !== evidence.subject.artifactSha256
      || createHash("sha256").update(canonicalJson(evidence.subject)).digest("hex") !== evidence.subjectDigest) return false;
    const receipt = evidence.receipt;
    if (!isObj(receipt) || receipt.schemaVersion !== RECEIPT_SCHEMA || receipt.keyId !== configured.keyId
      || receipt.subjectDigest !== evidence.subjectDigest || !isObj(receipt.result)
      || receipt.result.runner !== "trusted-runner" || receipt.result.passed !== true
      || receipt.result.exitCode !== evidence.exitCode
      || typeof receipt.result.durationMs !== "number" || !Number.isFinite(receipt.result.durationMs)
      || !text(receipt.result.summary).trim() || receipt.result.durationMs !== evidence.durationMs
      || receipt.result.summary !== evidence.summary) return false;
    const now = Date.now();
    const issuedAt = Date.parse(text(receipt.issuedAt));
    const expiresAt = Date.parse(text(receipt.expiresAt));
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now + 60_000
      || expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > 10 * 60 * 1000) return false;
    return verifySignature(null, Buffer.from(receiptPayload(receipt)), configured.key, Buffer.from(text(receipt.signature), "base64url"));
  } catch { return false; }
}

const BUILTIN_RULES = [
  { schemaVersion: RULE_SCHEMA, id: "no-inline-style", engine: "regex", pattern: "style\\s*=\\s*\\{|<[^>]+style\\s*=\\s*[\\\"'][^\\\"']*[\\\"']", flags: "gi", severity: "P0", message: "Inline style is forbidden", fix: "Use theme-backed CSS classes", version: "v1.0.0", exemptions: [] },
  { schemaVersion: RULE_SCHEMA, id: "no-hardcode-color", engine: "regex", pattern: "#[0-9a-fA-F]{3,8}\\b|rgb\\(|hsl\\(", flags: "g", severity: "P1", message: "Hardcoded color is forbidden", fix: "Use theme tokens", version: "v1.0.0", exemptions: [] },
  { schemaVersion: RULE_SCHEMA, id: "no-eval", engine: "regex", pattern: "\\beval\\s*\\(|new\\s+Function\\s*\\(", flags: "g", severity: "P0", message: "Dynamic evaluation is forbidden", fix: "Use a controlled parser", version: "v1.0.0", exemptions: [] },
  { schemaVersion: RULE_SCHEMA, id: "no-debug", engine: "regex", pattern: "\\bconsole\\.(log|debug|warn|error)\\s*\\(|debugger\\b", flags: "g", severity: "P1", message: "Debug code is forbidden", fix: "Remove debug code", version: "v1.0.0", exemptions: [] },
];
function validateExemption(exemption, ref) {
  if (!isObj(exemption) || !idRegex.test(text(exemption.exemptionId)) || !text(exemption.pathPattern).trim()
    || !text(exemption.reason).trim() || !idRegex.test(text(exemption.approvedBy)) || !text(exemption.ticket).trim()) return finding("P0", "RULEGUARD-EXEMPTION-AUDIT", ref, "Exemption requires id, path regex, reason, approver, and ticket");
  try { new RegExp(exemption.pathPattern); } catch { return finding("P0", "RULEGUARD-EXEMPTION-REGEX", ref, "Invalid exemption path regex"); }
  if (exemption.expiresAt !== undefined && !Number.isFinite(Date.parse(text(exemption.expiresAt)))) return finding("P0", "RULEGUARD-EXEMPTION-EXPIRY", ref, "expiresAt must be ISO date-time");
  return null;
}
function validateRule(rule, index) {
  const ref = `input.rules.${index}`;
  const findings = [];
  if (!isObj(rule) || rule.schemaVersion !== RULE_SCHEMA || !idRegex.test(text(rule.id)) || !idRegex.test(text(rule.version))) findings.push(finding("P0", "RULEGUARD-RULE-SCHEMA", ref, "Rule schema, id, and version are required"));
  if (rule?.engine !== "regex") findings.push(finding("P0", "RULEGUARD-AST-PLANNED", `${ref}.engine`, "Only regex DSL is implemented; AST is planned"));
  if (!text(rule?.pattern).trim() || text(rule.pattern).length > 512 || !/^[gimsuy]*$/.test(text(rule.flags))) findings.push(finding("P0", "RULEGUARD-REGEX-DSL", ref, "Pattern and valid regex flags are required"));
  try { new RegExp(rule.pattern, rule.flags); } catch { findings.push(finding("P0", "RULEGUARD-REGEX-COMPILE", ref, "Regex does not compile")); }
  if (!["P0", "P1", "P2"].includes(rule?.severity) || !text(rule?.message).trim() || !text(rule?.fix).trim()) findings.push(finding("P0", "RULEGUARD-RULE-METADATA", ref, "severity, message, and fix are required"));
  if (!Array.isArray(rule?.exemptions)) findings.push(finding("P0", "RULEGUARD-EXEMPTIONS", `${ref}.exemptions`, "Explicit exemptions array is required"));
  else rule.exemptions.forEach((item, exemptionIndex) => { const issue = validateExemption(item, `${ref}.exemptions.${exemptionIndex}`); if (issue) findings.push(issue); });
  return findings;
}
function compileRules(rules, version) {
  const findings = !idRegex.test(text(version)) ? [finding("P0", "RULESET-VERSION", "input.version", "Ruleset version is required")] : [];
  if (!Array.isArray(rules) || rules.length === 0) findings.push(finding("P0", "RULES-REQUIRED", "input.rules", "At least one regex rule is required"));
  else rules.forEach((rule, index) => findings.push(...validateRule(rule, index)));
  return findings.length ? { findings } : { findings, ruleset: { schemaVersion: RULESET_SCHEMA, version, engine: "regex", rules: rules.map((rule) => ({ ...rule })) } };
}
function matchingExemption(rule, path) {
  return rule.exemptions.find((exemption) => new RegExp(exemption.pathPattern).test(path)
    && (exemption.expiresAt === undefined || Date.parse(exemption.expiresAt) > Date.now()));
}
function runRuleguardScan(files, ruleset) {
  const compiled = compileRules(ruleset?.rules, ruleset?.version);
  if (ruleset?.schemaVersion !== RULESET_SCHEMA || ruleset?.engine !== "regex") compiled.findings.push(finding("P0", "RULESET-SCHEMA", "input.ruleset", "Expected regex RuleSet schema"));
  if (compiled.findings.length) return { findings: compiled.findings, violations: {}, exemptionAudit: [], totalViolations: compiled.findings.length, invalid: true };
  const findings = [], exemptionAudit = [], violations = {};
  for (const file of files) for (const rule of compiled.ruleset.rules) {
    const matches = text(file.content).match(new RegExp(rule.pattern, rule.flags.includes("g") ? rule.flags : `${rule.flags}g`));
    if (!matches) continue;
    const exemption = matchingExemption(rule, text(file.path));
    if (exemption) {
      exemptionAudit.push({ exemptionId: exemption.exemptionId, ruleId: rule.id, ruleVersion: rule.version,
        rulesetVersion: ruleset.version, path: text(file.path), reason: exemption.reason,
        approvedBy: exemption.approvedBy, ticket: exemption.ticket, status: "applied" });
      continue;
    }
    violations[rule.id] = (violations[rule.id] ?? 0) + matches.length;
    findings.push(finding(rule.severity, `RULEGUARD-${rule.id}`, text(file.path), `${rule.message}: ${matches.length} match(es)`, { ruleVersion: rule.version, sample: matches[0] }));
  }
  const totalViolations = Object.values(violations).reduce((total, count) => total + count, 0);
  return { findings, violations, exemptionAudit, totalViolations, invalid: false };
}

function validateReq(request) {
  const findings = [];
  if (!isObj(request)) return [finding("P0", "REQ_OBJECT", "request", "request must be an object")];
  if (request.schemaVersion !== REQ) findings.push(finding("P0", "REQ_SCHEMA", "request.schemaVersion", `Expected ${REQ}`));
  if (!text(request.requestId).trim()) findings.push(finding("P0", "REQ_FIELD", "request.requestId", "requestId is required"));
  if (!OPS.includes(request.operation)) findings.push(finding("P0", "REQ_OPERATION", "request.operation", "operation is unsupported"));
  if (!isObj(request.input)) findings.push(finding("P0", "REQ_INPUT", "request.input", "input must be an object"));
  return findings;
}
function localRunnerBlocked(requestId, operation) {
  return blocked(requestId, [finding("P0", "LOCAL-RUNNER-REQUIRED", `operation.${operation}`,
    `${operation} requires a real repository, persistent snapshot, and auditable local runner; this stateless runtime did not mutate anything`)]);
}
function meta(requestId, operation) {
  const operationStatus = { implementedPure: [...PURE], localRunnerRequired: [...LOCAL_RUNNER_REQUIRED], planned: PLANNED };
  const payload = { operationSchemas: SCHEMAS, nextStep: { operation: "intake", instruction: "Collect repository and risk contract." } };
  if (operation === "capabilities") return ok(requestId, { ...payload, capabilities: { stateless: true, operationStatus,
    mergeStrategies: { implemented: ["L1-regex-ruleguard"], planned: ["L2-structural", "L3-intent-runner"] },
    ruleguard: { engine: "regex", ruleSchema: RULE_SCHEMA, rulesetSchema: RULESET_SCHEMA }, catalogSchema: CATALOG_SCHEMA },
    skill: { name: NAME, version: COMPILER_VERSION } });
  return ok(requestId, { ...payload, help: { name: NAME, version: COMPILER_VERSION, operations: CATALOG, operationStatus } });
}

export async function run(request) {
  const validationFindings = validateReq(request);
  if (validationFindings.length) return { ...blocked(request?.requestId ?? "unknown", validationFindings), errorSchema: ERR };
  const { requestId, operation, input } = request;
  if (operation === "capabilities" || operation === "help") return meta(requestId, operation);
  if (operation === "intake") {
    if (!["git", "none", "snapshot"].includes(input.repoType) || !["low", "medium", "high"].includes(input.riskLevel) || !text(input.baselineRef).trim()) return blocked(requestId, [finding("P0", "INTAKE-REQUIRED", "input", "repoType, riskLevel, and baselineRef are required")]);
    return ok(requestId, { intake: { repoType: input.repoType, riskLevel: input.riskLevel, baselineRef: input.baselineRef,
      executionBoundary: "repository mutations require local runner" }, nextStep: { operation: "ruleguard-compile", instruction: "Compile versioned regex rules before local-runner preflight." } });
  }
  if (operation === "resolve-propose") {
    if (!idRegex.test(text(input.conflictId)) || !["keep-source", "keep-target", "ai-merge"].includes(input.strategy) || !text(input.context).trim()) return blocked(requestId, [finding("P0", "RESOLUTION-INPUT", "input", "conflictId, supported strategy, and context are required")]);
    return ok(requestId, { resolution: { conflictId: input.conflictId, strategy: input.strategy, status: "proposed", applied: false,
      requiresLocalRunnerAndValidator: true }, nextStep: { operation: "preflight", instruction: "Local runner must apply proposal in isolation and return evidence." } });
  }
  if (operation === "ruleguard-compile") {
    const compiled = compileRules(input.rules, input.version);
    if (compiled.findings.length) return blocked(requestId, compiled.findings);
    return ok(requestId, { ruleset: compiled.ruleset, nextStep: { operation: "ruleguard-scan", instruction: "Scan source with compiled regex ruleset." } });
  }
  if (operation === "ruleguard-scan") {
    if (!Array.isArray(input.files) || input.files.length === 0 || !isObj(input.ruleset)) return blocked(requestId, [finding("P0", "RULEGUARD-SCAN-INPUT", "input", "files and ruleset are required")]);
    const result = runRuleguardScan(input.files, input.ruleset);
    if (result.invalid) return blocked(requestId, result.findings);
    return ok(requestId, { findings: result.findings, violations: result.violations,
      exemptionAudit: result.exemptionAudit, totalViolations: result.totalViolations,
      nextStep: result.totalViolations ? { operation: "ruleguard-scan", instruction: "Fix violations or add explicitly audited exemptions." }
        : { operation: "preflight", instruction: "RuleGuard passed; repository preflight still requires local runner." } });
  }
  if (operation === "merge-verified") {
    if (!Array.isArray(input.validatorEvidence) || input.validatorEvidence.length === 0) return blocked(requestId, [finding("P0", "VALIDATOR-TEST-EVIDENCE-REQUIRED", "input.validatorEvidence", "Trusted Validator TestEvidence is required before merge")]);
    if (!input.validatorEvidence.every(trustedValidatorEvidence)) return blocked(requestId, [finding("P0", "VALIDATOR-TEST-EVIDENCE-UNTRUSTED", "input.validatorEvidence", "Validator evidence is local, unsigned, failed, expired, or not bound to its subject")]);
    return localRunnerBlocked(requestId, operation);
  }
  if (LOCAL_RUNNER_REQUIRED.has(operation)) return localRunnerBlocked(requestId, operation);
  return failed(requestId, "UNSUPPORTED_OPERATION", `Unsupported operation: ${operation}`);
}

export { COMPILER_VERSION, NAME, OPS, PURE, CATALOG, SCHEMAS, BUILTIN_RULES, RULE_SCHEMA,
  RULESET_SCHEMA, TEST_EVIDENCE_SCHEMA, runRuleguardScan, compileRules };
