import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const frozenSource = "176037d0afbe572f870a3c702985e7cd83fe6c0c";

export function evaluateTrivyReport(kind, report) {
  if (!["secret", "vulnerability"].includes(kind)) throw new Error(`unsupported Trivy report kind: ${kind}`);
  if (typeof report !== "object" || report === null || Array.isArray(report)) throw new Error("Trivy report must be an object");
  if (!Number.isInteger(report.SchemaVersion) || !Array.isArray(report.Results)) throw new Error("Trivy report is missing its schema version or results");

  const findings = [];
  for (const [resultIndex, result] of report.Results.entries()) {
    if (typeof result !== "object" || result === null || Array.isArray(result)) throw new Error(`Trivy result ${resultIndex} is malformed`);
    const entries = kind === "secret" ? result.Secrets ?? [] : result.Vulnerabilities ?? [];
    if (!Array.isArray(entries)) throw new Error(`Trivy result ${resultIndex} findings are malformed`);
    for (const [findingIndex, finding] of entries.entries()) {
      if (typeof finding !== "object" || finding === null || Array.isArray(finding)) throw new Error(`Trivy finding ${resultIndex}:${findingIndex} is malformed`);
      if (kind === "secret") {
        findings.push({ target: result.Target ?? "unknown", id: finding.RuleID ?? "unknown" });
      } else if (["HIGH", "CRITICAL"].includes(finding.Severity)) {
        findings.push({ target: result.Target ?? "unknown", id: finding.VulnerabilityID ?? "unknown", severity: finding.Severity });
      }
    }
  }
  return findings;
}

export function enforceSecretAllowlist(findings, allowlist, root) {
  const topKeys = new Set(["schemaVersion", "sourceCommit", "entries"]);
  if (typeof allowlist !== "object" || allowlist === null || Array.isArray(allowlist) || Object.keys(allowlist).some((key) => !topKeys.has(key))) throw new Error("secret allowlist is malformed");
  if (allowlist.schemaVersion !== "1.0.0" || allowlist.sourceCommit !== frozenSource || !Array.isArray(allowlist.entries)) throw new Error("secret allowlist does not match the frozen source");

  const expected = new Map();
  for (const entry of allowlist.entries) {
    const entryKeys = new Set(["path", "sha256", "findings", "reason"]);
    if (typeof entry !== "object" || entry === null || Array.isArray(entry) || Object.keys(entry).some((key) => !entryKeys.has(key))) throw new Error("secret allowlist entry is malformed");
    if (!/^[a-zA-Z0-9._/-]+$/.test(entry.path ?? "") || entry.path.startsWith("/") || entry.path.includes("..") || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? "") || typeof entry.reason !== "string" || !entry.reason.trim() || !Array.isArray(entry.findings)) throw new Error("secret allowlist entry is incomplete");
    const body = readFileSync(resolve(root, entry.path));
    const actualHash = createHash("sha256").update(body).digest("hex");
    if (actualHash !== entry.sha256) throw new Error(`secret allowlist file hash changed: ${entry.path}`);
    for (const finding of entry.findings) {
      const findingKeys = new Set(["ruleId", "count"]);
      if (typeof finding !== "object" || finding === null || Array.isArray(finding) || Object.keys(finding).some((key) => !findingKeys.has(key)) || !/^[a-z0-9-]+$/.test(finding.ruleId ?? "") || !Number.isInteger(finding.count) || finding.count < 1) throw new Error("secret allowlist finding is malformed");
      const key = `${entry.path}\n${finding.ruleId}`;
      if (expected.has(key)) throw new Error(`duplicate secret allowlist finding: ${entry.path} ${finding.ruleId}`);
      expected.set(key, finding.count);
    }
  }

  const actual = new Map();
  for (const finding of findings) {
    const key = `${finding.target}\n${finding.id}`;
    actual.set(key, (actual.get(key) ?? 0) + 1);
  }
  if (expected.size !== actual.size || [...expected].some(([key, count]) => actual.get(key) !== count)) {
    throw new Error("Trivy secret findings do not exactly match the hash-bound allowlist");
  }
  return findings.length;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const [, , kind, file, ...options] = process.argv;
  if (!kind || !file) throw new Error("usage: enforce-trivy-report.mjs <secret|vulnerability> <report.json>");
  const report = JSON.parse(readFileSync(file, "utf8"));
  const findings = evaluateTrivyReport(kind, report);
  const allowlistIndex = options.indexOf("--allowlist");
  const rootIndex = options.indexOf("--root");
  if (allowlistIndex !== -1) {
    if (kind !== "secret" || !options[allowlistIndex + 1] || rootIndex === -1 || !options[rootIndex + 1]) throw new Error("secret allowlist requires --allowlist <file> --root <source-root>");
    const allowlist = JSON.parse(readFileSync(options[allowlistIndex + 1], "utf8"));
    const accepted = enforceSecretAllowlist(findings, allowlist, options[rootIndex + 1]);
    console.log(`Trivy secret policy accepted ${accepted} exact hash-bound upstream fixture finding(s).`);
  } else if (findings.length) {
    throw new Error(`Trivy ${kind} policy rejected ${findings.length} finding(s): ${JSON.stringify(findings)}`);
  }
  console.log(`Trivy ${kind} policy passed with zero rejected findings.`);
}
