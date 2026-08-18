import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { enforceSecretAllowlist, evaluateTrivyReport } from "./enforce-trivy-report.mjs";

test("accepts complete reports with no rejected findings", () => {
  assert.deepEqual(evaluateTrivyReport("secret", { SchemaVersion: 2, Results: [{ Target: "source", Secrets: null }] }), []);
  assert.deepEqual(
    evaluateTrivyReport("vulnerability", {
      SchemaVersion: 2,
      Results: [{ Target: "image", Vulnerabilities: [{ VulnerabilityID: "LOW-1", Severity: "LOW" }] }],
    }),
    [],
  );
});

test("rejects every secret and HIGH or CRITICAL vulnerability", () => {
  assert.equal(
    evaluateTrivyReport("secret", { SchemaVersion: 2, Results: [{ Target: "source", Secrets: [{ RuleID: "private-key" }] }] }).length,
    1,
  );
  assert.deepEqual(
    evaluateTrivyReport("vulnerability", {
      SchemaVersion: 2,
      Results: [{ Target: "image", Vulnerabilities: [{ VulnerabilityID: "CVE-H", Severity: "HIGH" }, { VulnerabilityID: "CVE-C", Severity: "CRITICAL" }] }],
    }).map(({ severity }) => severity),
    ["HIGH", "CRITICAL"],
  );
});

test("fails closed on missing or malformed scanner output", () => {
  assert.throws(() => evaluateTrivyReport("secret", {}), /missing its schema version or results/);
  assert.throws(() => evaluateTrivyReport("secret", { SchemaVersion: 2, Results: [{ Secrets: "none" }] }), /findings are malformed/);
  assert.throws(() => evaluateTrivyReport("vulnerability", { SchemaVersion: 2, Results: [null] }), /result 0 is malformed/);
  assert.throws(() => evaluateTrivyReport("unknown", { SchemaVersion: 2, Results: [] }), /unsupported/);
});

test("secret exceptions require the exact path, rule count, frozen source, and file hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "trivy-allowlist-"));
  const file = join(root, "fixture.txt");
  const body = "documented test fixture";
  await writeFile(file, body);
  const allowlist = {
    schemaVersion: "1.0.0",
    sourceCommit: "176037d0afbe572f870a3c702985e7cd83fe6c0c",
    entries: [{ path: "fixture.txt", sha256: createHash("sha256").update(body).digest("hex"), findings: [{ ruleId: "example-token", count: 1 }], reason: "test" }],
  };
  const finding = [{ target: "fixture.txt", id: "example-token" }];
  assert.equal(enforceSecretAllowlist(finding, allowlist, root), 1);
  assert.throws(() => enforceSecretAllowlist([...finding, ...finding], allowlist, root), /exactly match/);
  assert.throws(() => enforceSecretAllowlist([{ target: "fixture.txt", id: "new-token" }], allowlist, root), /exactly match/);
  await writeFile(file, `${body} changed`);
  assert.throws(() => enforceSecretAllowlist(finding, allowlist, root), /file hash changed/);
});
