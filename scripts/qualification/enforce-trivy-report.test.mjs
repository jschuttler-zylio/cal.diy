import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  enforceSecretAllowlist,
  enforceVulnerabilityAllowlist,
  evaluateTrivyReport,
} from "./enforce-trivy-report.mjs";

test("accepts complete reports with no rejected findings", () => {
  assert.deepEqual(
    evaluateTrivyReport("secret", { SchemaVersion: 2, Results: [{ Target: "source", Secrets: null }] }),
    []
  );
  assert.deepEqual(
    evaluateTrivyReport("vulnerability", {
      SchemaVersion: 2,
      Results: [{ Target: "image", Vulnerabilities: [{ VulnerabilityID: "LOW-1", Severity: "LOW" }] }],
    }),
    []
  );
});

test("rejects every secret and HIGH or CRITICAL vulnerability", () => {
  assert.equal(
    evaluateTrivyReport("secret", {
      SchemaVersion: 2,
      Results: [{ Target: "source", Secrets: [{ RuleID: "private-key" }] }],
    }).length,
    1
  );
  assert.deepEqual(
    evaluateTrivyReport("vulnerability", {
      SchemaVersion: 2,
      Results: [
        {
          Target: "[linux/amd64] image",
          Type: "node-pkg",
          Vulnerabilities: [
            {
              VulnerabilityID: "CVE-H",
              Severity: "HIGH",
              PkgName: "package-h",
              InstalledVersion: "1.0.0",
              Status: "affected",
            },
            {
              VulnerabilityID: "CVE-C",
              Severity: "CRITICAL",
              PkgName: "package-c",
              InstalledVersion: "1.0.0",
              Status: "affected",
            },
          ],
        },
      ],
    }).map(({ severity }) => severity),
    ["HIGH", "CRITICAL"]
  );
});

test("fails closed on missing or malformed scanner output", () => {
  assert.throws(() => evaluateTrivyReport("secret", {}), /missing its schema version or results/);
  assert.throws(
    () => evaluateTrivyReport("secret", { SchemaVersion: 2, Results: [{ Secrets: "none" }] }),
    /findings are malformed/
  );
  assert.throws(
    () => evaluateTrivyReport("vulnerability", { SchemaVersion: 2, Results: [null] }),
    /result 0 is malformed/
  );
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
    entries: [
      {
        path: "fixture.txt",
        sha256: createHash("sha256").update(body).digest("hex"),
        findings: [{ ruleId: "example-token", count: 1 }],
        reason: "test",
      },
    ],
  };
  const finding = [{ target: "fixture.txt", id: "example-token" }];
  assert.equal(enforceSecretAllowlist(finding, allowlist, root), 1);
  assert.throws(() => enforceSecretAllowlist([...finding, ...finding], allowlist, root), /exactly match/);
  assert.throws(
    () => enforceSecretAllowlist([{ target: "fixture.txt", id: "new-token" }], allowlist, root),
    /exactly match/
  );
  await writeFile(file, `${body} changed`);
  assert.throws(() => enforceSecretAllowlist(finding, allowlist, root), /file hash changed/);
});

const vulnerabilityFinding = {
  target: "[linux/amd64] image (node-pkg)",
  id: "CVE-2026-40345",
  severity: "HIGH",
  platform: "linux/amd64",
  packageType: "node-pkg",
  packageName: "deepmerge-ts",
  installedVersion: "7.1.5",
  fixedVersion: "8.0.0",
  status: "fixed",
};
const vulnerabilityAllowlist = {
  schemaVersion: "1.0.0",
  lastReviewed: "2026-08-20",
  expiresOn: "2026-11-18",
  cisaKevCatalogVersion: "2026.08.19",
  entries: [
    {
      vulnerabilityId: "CVE-2026-40345",
      packageName: "deepmerge-ts",
      installedVersion: "7.1.5",
      severity: "HIGH",
      status: "fixed",
      fixedVersion: "8.0.0",
      packageType: "node-pkg",
      platforms: ["linux/amd64", "linux/arm64"],
      occurrencesPerPlatform: 1,
      paths: ["calcom/maintenance/node_modules/deepmerge-ts/package.json"],
      reason:
        "The package is limited to the root-owned Prisma migration CLI and cannot receive request data.",
    },
  ],
};
const vulnerabilitySbom = {
  bomFormat: "CycloneDX",
  components: [
    {
      type: "library",
      name: "deepmerge-ts",
      version: "7.1.5",
      purl: "pkg:npm/deepmerge-ts@7.1.5",
      properties: [
        {
          name: "aquasecurity:trivy:FilePath",
          value: "calcom/maintenance/node_modules/deepmerge-ts/package.json",
        },
      ],
    },
  ],
};

test("vulnerability exceptions require exact identity, both native platforms, count, SBOM path, and expiry", () => {
  const findings = [
    vulnerabilityFinding,
    { ...vulnerabilityFinding, target: "[linux/arm64] image (node-pkg)", platform: "linux/arm64" },
  ];
  assert.equal(
    enforceVulnerabilityAllowlist(
      findings,
      vulnerabilityAllowlist,
      vulnerabilitySbom,
      new Date("2026-08-20T12:00:00Z")
    ),
    2
  );
  assert.throws(
    () =>
      enforceVulnerabilityAllowlist(
        [...findings, { ...vulnerabilityFinding, id: "CVE-UNEXPECTED" }],
        vulnerabilityAllowlist,
        vulnerabilitySbom,
        new Date("2026-08-20T12:00:00Z")
      ),
    /do not exactly match/
  );
  assert.throws(
    () =>
      enforceVulnerabilityAllowlist(
        findings,
        vulnerabilityAllowlist,
        {
          ...vulnerabilitySbom,
          components: vulnerabilitySbom.components.map((component) => ({
            ...component,
            properties: component.properties.map((property) => ({
              ...property,
              value: "calcom/node_modules/deepmerge-ts/package.json",
            })),
          })),
        },
        new Date("2026-08-20T12:00:00Z")
      ),
    /SBOM paths do not exactly match/
  );
  assert.throws(
    () =>
      enforceVulnerabilityAllowlist(
        findings,
        vulnerabilityAllowlist,
        vulnerabilitySbom,
        new Date("2026-11-19T00:00:00Z")
      ),
    /expired/
  );
});
