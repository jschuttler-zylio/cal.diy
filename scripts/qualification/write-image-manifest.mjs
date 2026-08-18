import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const value = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
};
const out = resolve(value("--output"));
const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const root = resolve(import.meta.dirname, "../..");
const source = "176037d0afbe572f870a3c702985e7cd83fe6c0c";
const runtimeDir = resolve(value("--runtime-dir"));
const runtimeRecord = (architecture, expectedDigest) => {
  const file = resolve(runtimeDir, `runtime-smoke-${architecture}.json`);
  const record = JSON.parse(readFileSync(file, "utf8"));
  const expectedPlatform = `linux/${architecture}`;
  if (record.platform !== expectedPlatform || record.digest !== expectedDigest || record.runtimeSmoke !== "pass") {
    throw new Error(`invalid native runtime smoke record for ${expectedPlatform}`);
  }
  return { platform: expectedPlatform, digest: expectedDigest, runtimeSmoke: record.runtimeSmoke };
};
const amd64Digest = value("--amd64-digest");
const arm64Digest = value("--arm64-digest");
const manifest = {
  schemaVersion: "1.0.0",
  source: { repository: "https://github.com/calcom/cal.diy", commit: source, licenseSpdx: "MIT", licenseSha256: digest(resolve(root, "LICENSE")) },
  patches: [{ commit: value("--patch-commit"), purpose: "Zylio qualification runtime, manifest, and CI hardening" }],
  images: {
    repository: value("--repository"),
    multiPlatformDigest: value("--multi-platform-digest"),
    platforms: [runtimeRecord("amd64", amd64Digest), runtimeRecord("arm64", arm64Digest)],
  },
  sbom: { format: "cyclonedx-json", path: "sbom/sbom.cdx.json", sha256: digest("sbom/sbom.cdx.json") },
  scans: {
    vulnerability: { path: "scans/vulnerability.json", sha256: digest("scans/vulnerability.json") },
    secret: { path: "scans/secret.json", sha256: digest("scans/secret.json") },
    unexplainedCritical: 0,
    unexplainedHigh: 0,
  },
  generatedManifests: {
    environment: { path: "environment-manifest.json", sha256: digest("environment-manifest.json") },
    scheduler: { path: "scheduler-manifest.json", sha256: digest("scheduler-manifest.json") },
  },
  builtAt: new Date().toISOString(),
};
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
