import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const frozenSource = "176037d0afbe572f870a3c702985e7cd83fe6c0c";

export function evaluateTrivyReport(kind, report) {
  if (!["secret", "vulnerability"].includes(kind)) throw new Error(`unsupported Trivy report kind: ${kind}`);
  if (typeof report !== "object" || report === null || Array.isArray(report))
    throw new Error("Trivy report must be an object");
  if (!Number.isInteger(report.SchemaVersion) || !Array.isArray(report.Results))
    throw new Error("Trivy report is missing its schema version or results");

  const findings = [];
  for (const [resultIndex, result] of report.Results.entries()) {
    if (typeof result !== "object" || result === null || Array.isArray(result))
      throw new Error(`Trivy result ${resultIndex} is malformed`);
    let entries = result.Vulnerabilities ?? [];
    if (kind === "secret") entries = result.Secrets ?? [];
    if (!Array.isArray(entries)) throw new Error(`Trivy result ${resultIndex} findings are malformed`);
    for (const [findingIndex, finding] of entries.entries()) {
      if (typeof finding !== "object" || finding === null || Array.isArray(finding))
        throw new Error(`Trivy finding ${resultIndex}:${findingIndex} is malformed`);
      if (kind === "secret") {
        findings.push({ target: result.Target ?? "unknown", id: finding.RuleID ?? "unknown" });
      } else if (["HIGH", "CRITICAL"].includes(finding.Severity)) {
        const target = result.Target ?? "unknown";
        const platform = /^\[(linux\/(?:amd64|arm64))\]/.exec(target)?.[1];
        if (
          !platform ||
          !["debian", "node-pkg"].includes(result.Type) ||
          typeof finding.VulnerabilityID !== "string" ||
          typeof finding.PkgName !== "string" ||
          typeof finding.InstalledVersion !== "string" ||
          typeof finding.Status !== "string"
        ) {
          throw new Error(
            `Trivy vulnerability finding ${resultIndex}:${findingIndex} lacks exact identity fields`
          );
        }
        findings.push({
          target,
          id: finding.VulnerabilityID,
          severity: finding.Severity,
          platform,
          packageType: result.Type,
          packageName: finding.PkgName,
          installedVersion: finding.InstalledVersion,
          fixedVersion: finding.FixedVersion ?? null,
          status: finding.Status,
        });
      }
    }
  }
  return findings;
}

export function enforceSecretAllowlist(findings, allowlist, root) {
  const topKeys = new Set(["schemaVersion", "sourceCommit", "entries"]);
  if (
    typeof allowlist !== "object" ||
    allowlist === null ||
    Array.isArray(allowlist) ||
    Object.keys(allowlist).some((key) => !topKeys.has(key))
  )
    throw new Error("secret allowlist is malformed");
  if (
    allowlist.schemaVersion !== "1.0.0" ||
    allowlist.sourceCommit !== frozenSource ||
    !Array.isArray(allowlist.entries)
  )
    throw new Error("secret allowlist does not match the frozen source");

  const expected = new Map();
  for (const entry of allowlist.entries) {
    const entryKeys = new Set(["path", "sha256", "findings", "reason"]);
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      Object.keys(entry).some((key) => !entryKeys.has(key))
    )
      throw new Error("secret allowlist entry is malformed");
    if (
      !/^[a-zA-Z0-9._/-]+$/.test(entry.path ?? "") ||
      entry.path.startsWith("/") ||
      entry.path.includes("..") ||
      !/^[0-9a-f]{64}$/.test(entry.sha256 ?? "") ||
      typeof entry.reason !== "string" ||
      !entry.reason.trim() ||
      !Array.isArray(entry.findings)
    )
      throw new Error("secret allowlist entry is incomplete");
    const body = readFileSync(resolve(root, entry.path));
    const actualHash = createHash("sha256").update(body).digest("hex");
    if (actualHash !== entry.sha256) throw new Error(`secret allowlist file hash changed: ${entry.path}`);
    for (const finding of entry.findings) {
      const findingKeys = new Set(["ruleId", "count"]);
      if (
        typeof finding !== "object" ||
        finding === null ||
        Array.isArray(finding) ||
        Object.keys(finding).some((key) => !findingKeys.has(key)) ||
        !/^[a-z0-9-]+$/.test(finding.ruleId ?? "") ||
        !Number.isInteger(finding.count) ||
        finding.count < 1
      )
        throw new Error("secret allowlist finding is malformed");
      const key = `${entry.path}\n${finding.ruleId}`;
      if (expected.has(key))
        throw new Error(`duplicate secret allowlist finding: ${entry.path} ${finding.ruleId}`);
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

function sbomPackages(sbom) {
  if (
    typeof sbom !== "object" ||
    sbom === null ||
    Array.isArray(sbom) ||
    sbom.bomFormat !== "CycloneDX" ||
    !Array.isArray(sbom.components)
  ) {
    throw new Error("CycloneDX SBOM is malformed");
  }
  const packages = new Map();
  for (const component of sbom.components) {
    if (
      typeof component !== "object" ||
      component === null ||
      Array.isArray(component) ||
      typeof component.name !== "string" ||
      typeof component.version !== "string"
    ) {
      throw new Error("CycloneDX SBOM component is malformed");
    }
    let packageType = null;
    if (component.purl?.startsWith("pkg:npm/")) packageType = "node-pkg";
    else if (component.purl?.startsWith("pkg:deb/")) packageType = "debian";
    if (!packageType) continue;
    const paths = (component.properties ?? [])
      .filter((property) => property?.name === "aquasecurity:trivy:FilePath")
      .map((property) => property.value);
    if (
      paths.some(
        (path) =>
          typeof path !== "string" ||
          !path ||
          path.startsWith("/") ||
          path.includes("..") ||
          path.includes("\\")
      )
    ) {
      throw new Error("CycloneDX SBOM package path is malformed");
    }
    const key = `${packageType}\n${component.name}\n${component.version}`;
    const knownPaths = packages.get(key) ?? new Set();
    for (const path of paths) knownPaths.add(path);
    packages.set(key, knownPaths);
  }
  return packages;
}

const vulnerabilityKey = (finding) =>
  [
    finding.id,
    finding.packageName,
    finding.installedVersion,
    finding.severity,
    finding.status,
    finding.fixedVersion ?? "",
    finding.packageType,
    finding.platform,
  ].join("\n");

export function enforceVulnerabilityAllowlist(findings, allowlist, sbom, now = new Date()) {
  const topKeys = new Set(["schemaVersion", "lastReviewed", "expiresOn", "cisaKevCatalogVersion", "entries"]);
  if (
    typeof allowlist !== "object" ||
    allowlist === null ||
    Array.isArray(allowlist) ||
    Object.keys(allowlist).some((key) => !topKeys.has(key)) ||
    allowlist.schemaVersion !== "1.0.0" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(allowlist.lastReviewed ?? "") ||
    !/^\d{4}-\d{2}-\d{2}$/.test(allowlist.expiresOn ?? "") ||
    !/^\d{4}\.\d{2}\.\d{2}$/.test(allowlist.cisaKevCatalogVersion ?? "") ||
    !Array.isArray(allowlist.entries)
  ) {
    throw new Error("vulnerability allowlist is malformed");
  }
  if (allowlist.expiresOn <= allowlist.lastReviewed) {
    throw new Error("vulnerability allowlist expiry must follow its review date");
  }
  if (!(now instanceof Date) || Number.isNaN(now.valueOf()))
    throw new Error("vulnerability policy clock is invalid");
  if (now.toISOString().slice(0, 10) > allowlist.expiresOn) {
    throw new Error(`vulnerability allowlist expired on ${allowlist.expiresOn}`);
  }

  const packages = sbomPackages(sbom);
  const expected = new Map();
  const seenEntries = new Set();
  for (const entry of allowlist.entries) {
    const entryKeys = new Set([
      "vulnerabilityId",
      "packageName",
      "installedVersion",
      "severity",
      "status",
      "fixedVersion",
      "packageType",
      "platforms",
      "occurrencesPerPlatform",
      "paths",
      "reason",
    ]);
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      Object.keys(entry).some((key) => !entryKeys.has(key)) ||
      !/^(?:CVE-\d{4}-\d+|GHSA-[a-z0-9-]+)$/.test(entry.vulnerabilityId ?? "") ||
      typeof entry.packageName !== "string" ||
      !entry.packageName ||
      typeof entry.installedVersion !== "string" ||
      !entry.installedVersion ||
      !["HIGH", "CRITICAL"].includes(entry.severity) ||
      typeof entry.status !== "string" ||
      !entry.status ||
      !(entry.fixedVersion === null || (typeof entry.fixedVersion === "string" && entry.fixedVersion)) ||
      !["debian", "node-pkg"].includes(entry.packageType) ||
      !Array.isArray(entry.platforms) ||
      entry.platforms.length !== 2 ||
      entry.platforms[0] !== "linux/amd64" ||
      entry.platforms[1] !== "linux/arm64" ||
      !Number.isInteger(entry.occurrencesPerPlatform) ||
      entry.occurrencesPerPlatform < 1 ||
      !Array.isArray(entry.paths) ||
      entry.paths.some(
        (path) =>
          typeof path !== "string" ||
          !path ||
          path.startsWith("/") ||
          path.includes("..") ||
          path.includes("\\")
      ) ||
      typeof entry.reason !== "string" ||
      !entry.reason.trim()
    ) {
      throw new Error("vulnerability allowlist entry is malformed");
    }
    const entryIdentity = [
      entry.vulnerabilityId,
      entry.packageName,
      entry.installedVersion,
      entry.packageType,
    ].join("\n");
    if (seenEntries.has(entryIdentity)) {
      throw new Error(
        `duplicate vulnerability allowlist entry: ${entry.vulnerabilityId} ${entry.packageName}`
      );
    }
    seenEntries.add(entryIdentity);

    const packageKey = `${entry.packageType}\n${entry.packageName}\n${entry.installedVersion}`;
    if (!packages.has(packageKey)) {
      throw new Error(
        `allowlisted package is absent from SBOM: ${entry.packageName}@${entry.installedVersion}`
      );
    }
    const actualPaths = [...packages.get(packageKey)].sort();
    const expectedPaths = [...new Set(entry.paths)].sort();
    if (
      expectedPaths.length !== entry.paths.length ||
      actualPaths.length !== expectedPaths.length ||
      actualPaths.some((path, index) => path !== expectedPaths[index]) ||
      (entry.packageType === "node-pkg" && expectedPaths.length === 0) ||
      (entry.packageType === "debian" && expectedPaths.length !== 0)
    ) {
      throw new Error(`SBOM paths do not exactly match vulnerability allowlist: ${entry.packageName}`);
    }
    for (const platform of entry.platforms) {
      const key = vulnerabilityKey({
        id: entry.vulnerabilityId,
        packageName: entry.packageName,
        installedVersion: entry.installedVersion,
        severity: entry.severity,
        status: entry.status,
        fixedVersion: entry.fixedVersion,
        packageType: entry.packageType,
        platform,
      });
      expected.set(key, entry.occurrencesPerPlatform);
    }
  }

  const actual = new Map();
  for (const finding of findings) {
    const key = vulnerabilityKey(finding);
    actual.set(key, (actual.get(key) ?? 0) + 1);
  }
  if (expected.size !== actual.size || [...expected].some(([key, count]) => actual.get(key) !== count)) {
    const rejected = findings.filter((finding) => !expected.has(vulnerabilityKey(finding)));
    let rejectedDetail = "";
    if (rejected.length) rejectedDetail = `: ${JSON.stringify(rejected)}`;
    throw new Error(
      `Trivy vulnerability findings do not exactly match the expiring allowlist${rejectedDetail}`
    );
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
  const sbomIndex = options.indexOf("--sbom");
  if (allowlistIndex !== -1) {
    const allowlist = JSON.parse(readFileSync(options[allowlistIndex + 1], "utf8"));
    if (kind === "secret") {
      if (!options[allowlistIndex + 1] || rootIndex === -1 || !options[rootIndex + 1])
        throw new Error("secret allowlist requires --allowlist <file> --root <source-root>");
      const accepted = enforceSecretAllowlist(findings, allowlist, options[rootIndex + 1]);
      console.log(`Trivy secret policy accepted ${accepted} exact hash-bound upstream fixture finding(s).`);
    } else {
      if (!options[allowlistIndex + 1] || sbomIndex === -1 || !options[sbomIndex + 1])
        throw new Error("vulnerability allowlist requires --allowlist <file> --sbom <CycloneDX-file>");
      const sbom = JSON.parse(readFileSync(options[sbomIndex + 1], "utf8"));
      const accepted = enforceVulnerabilityAllowlist(findings, allowlist, sbom);
      console.log(`Trivy vulnerability policy accepted ${accepted} exact reviewed, expiring VEX finding(s).`);
    }
  } else if (findings.length) {
    throw new Error(
      `Trivy ${kind} policy rejected ${findings.length} finding(s): ${JSON.stringify(findings)}`
    );
  }
  console.log(`Trivy ${kind} policy passed with zero rejected findings.`);
}
