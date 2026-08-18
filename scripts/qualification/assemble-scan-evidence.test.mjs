import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleScanEvidence } from "./assemble-scan-evidence.mjs";

const result = (target, fields = {}) => ({ Target: target, Class: "os-pkgs", Type: "debian", ...fields });
const report = (results) => ({ SchemaVersion: 2, ArtifactName: "fixture", ArtifactType: "container_image", Results: results });

test("assembles source and both native image scans without losing platform provenance", () => {
  const source = report([result("fixture.ts", { Secrets: [] })]);
  const amd64 = report([result("bookworm", { Vulnerabilities: [{ VulnerabilityID: "CVE-A", Severity: "LOW" }], Secrets: [] })]);
  const arm64 = report([result("bookworm", { Vulnerabilities: [], Secrets: [{ RuleID: "unexpected" }] })]);
  const assembled = assembleScanEvidence(source, [
    { platform: "linux/amd64", report: amd64 },
    { platform: "linux/arm64", report: arm64 },
  ]);
  assert.deepEqual(assembled.vulnerability.Results.map(({ Target }) => Target), ["[linux/amd64] bookworm", "[linux/arm64] bookworm"]);
  assert.deepEqual(assembled.secret.Results.map(({ Target }) => Target), ["fixture.ts", "[linux/amd64] bookworm", "[linux/arm64] bookworm"]);
  assert.equal(assembled.secret.Results[2].Secrets[0].RuleID, "unexpected");
});

test("rejects mixed Trivy schema versions", () => {
  assert.throws(() => assembleScanEvidence(report([]), [{ platform: "linux/amd64", report: { ...report([]), SchemaVersion: 1 } }]), /schema versions/);
});
