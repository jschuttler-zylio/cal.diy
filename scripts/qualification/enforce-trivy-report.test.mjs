import assert from "node:assert/strict";
import test from "node:test";

import { evaluateTrivyReport } from "./enforce-trivy-report.mjs";

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
