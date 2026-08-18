import { readFileSync } from "node:fs";

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

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const [, , kind, file] = process.argv;
  if (!kind || !file) throw new Error("usage: enforce-trivy-report.mjs <secret|vulnerability> <report.json>");
  const report = JSON.parse(readFileSync(file, "utf8"));
  const findings = evaluateTrivyReport(kind, report);
  if (findings.length) throw new Error(`Trivy ${kind} policy rejected ${findings.length} finding(s): ${JSON.stringify(findings)}`);
  console.log(`Trivy ${kind} policy passed with zero rejected findings.`);
}
