import { readFileSync, writeFileSync } from "node:fs";

const readReport = (file, label) => {
  let report;
  try {
    report = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (typeof report !== "object" || report === null || Array.isArray(report) ||
      !Number.isInteger(report.SchemaVersion) || !Array.isArray(report.Results)) {
    throw new Error(`${label} is not a complete Trivy JSON report`);
  }
  return report;
};

const platformResults = (report, platform) => report.Results.map((result, index) => {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error(`${platform} Trivy result ${index} is malformed`);
  }
  return { ...result, Target: `[${platform}] ${result.Target ?? "unknown"}` };
});

export function assembleScanEvidence(sourceSecret, nativeReports) {
  const reports = [sourceSecret, ...nativeReports.map(({ report }) => report)];
  if (reports.some((report) => report.SchemaVersion !== sourceSecret.SchemaVersion)) {
    throw new Error("Trivy report schema versions do not match");
  }
  const nativeResults = nativeReports.flatMap(({ platform, report }) => platformResults(report, platform));
  return {
    vulnerability: {
      SchemaVersion: sourceSecret.SchemaVersion,
      ArtifactName: "qualification-native-images",
      ArtifactType: "container_image",
      Results: nativeResults,
    },
    secret: {
      SchemaVersion: sourceSecret.SchemaVersion,
      ArtifactName: "qualification-source-and-native-images",
      ArtifactType: "qualification_evidence",
      Results: [...sourceSecret.Results, ...nativeResults],
    },
  };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const value = (name) => {
    const index = process.argv.indexOf(name);
    if (index === -1 || !process.argv[index + 1]) throw new Error(`${name} is required`);
    return process.argv[index + 1];
  };
  const sourceSecret = readReport(value("--source-secret"), "source secret report");
  const nativeReports = ["amd64", "arm64"].map((architecture) => ({
    platform: `linux/${architecture}`,
    report: readReport(value(`--${architecture}`), `${architecture} image report`),
  }));
  const assembled = assembleScanEvidence(sourceSecret, nativeReports);
  writeFileSync(value("--vulnerability-output"), `${JSON.stringify(assembled.vulnerability, null, 2)}\n`);
  writeFileSync(value("--secret-output"), `${JSON.stringify(assembled.secret, null, 2)}\n`);
}
