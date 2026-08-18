import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (file) => readFileSync(resolve(root, file), "utf8");
const compose = read("deploy/qualification/docker-compose.web.yml");
const profileDocs = read("deploy/qualification/README.md");
const start = read("scripts/qualification-web-start.sh");
const entrypoint = read("scripts/qualification-entrypoint.sh");
const workflow = read(".github/workflows/zylio-qualification-image.yml");
const dockerfile = read("Dockerfile");
const repository = read("packages/features/tasker/repository.ts");
const processor = read("packages/features/tasker/task-processor.ts");
const secretAllowlist = JSON.parse(read("deploy/qualification/trivy-secret-allowlist.json"));
const requiredFiles = [
  "DATABASE_URL",
  "DATABASE_DIRECT_URL",
  "NEXTAUTH_SECRET",
  "CALENDSO_ENCRYPTION_KEY",
  "CRON_API_KEY",
  "CRON_SECRET",
  "NEXT_PUBLIC_WEBAPP_URL",
  "NEXTAUTH_URL",
  "ALLOWED_HOSTNAMES",
  "CALCOM_TELEMETRY_DISABLED",
  "TASKER_RETENTION_DAYS",
  "EMAIL_SERVER_HOST",
  "EMAIL_SERVER_PORT",
  "EMAIL_SERVER_USER",
  "EMAIL_SERVER_PASSWORD",
  "EMAIL_FROM",
  "EMAIL_FROM_NAME",
  "USE_POOL",
  "NEXT_PUBLIC_DISABLE_SIGNUP",
];
for (const required of ["@sha256", "profiles: [maintenance]", "cap_drop: [ALL]", "DATABASE_URL_FILE", "tenant-egress", "external-proxy"]) {
  if (!compose.includes(required)) throw new Error(`qualification compose missing ${required}`);
}
for (const forbidden of ["redis", "calcom-api", "studio", "ports:", "env_file:"]) {
  if (compose.includes(forbidden)) throw new Error(`qualification compose contains forbidden ${forbidden}`);
}
if (/x-hardening:[\s\S]*?read_only:\s*true/.test(compose)) throw new Error("Compose claims read-only despite URL replacement");
if (!profileDocs.includes("intentionally writable") || !profileDocs.includes("persistent data mount")) {
  throw new Error("writable runtime exception is not documented");
}
for (const name of requiredFiles) {
  if (!entrypoint.includes(name) || !compose.includes(`${name}_FILE`)) throw new Error(`missing file-backed runtime mapping: ${name}`);
}
for (const forbidden of ["migrate deploy", "seed-app-store"]) {
  if (start.includes(forbidden)) throw new Error(`web startup mutates database: ${forbidden}`);
}
for (const required of [
  "linux/amd64",
  "linux/arm64",
  "provenance: mode=max",
  "sbom: true",
  "gitleaks/gitleaks-action@",
  "TRIVY_IMAGE: ghcr.io/aquasecurity/trivy@sha256:a22415a38938a56c379387a8163fcb0ce38b10ace73e593475d3658d578b2436",
  "--image-src remote",
  "enforce-trivy-report.mjs",
  "generate-manifests.mjs --output qualification-artifacts --built",
  "write-image-manifest.mjs",
  "Runtime smoke on the native runner with PostgreSQL",
  "verify-contract-hashes.mjs",
  "validate-manifests.mjs",
  "verify-runtime-smokes.mjs",
  "SMOKE_POSTGRES_IMAGE: docker.io/library/postgres:16.10-bookworm@sha256:",
  "SMOKE_POSTGRES_PLATFORMS: linux/amd64,linux/arm64",
  "NEXT_PUBLIC_DISABLE_SIGNUP=true",
  "CALCOM_TELEMETRY_DISABLED=1",
  "apps/**",
  "example-apps/**",
  "packages/**",
  "scripts/**",
  "deploy/qualification/**",
  ".github/workflows/cron-*.yml",
]) {
  if (!workflow.includes(required)) throw new Error(`workflow missing ${required}`);
}
for (const line of workflow.split(/\r?\n/).filter((line) => line.includes("uses:"))) {
  if (!/@[0-9a-f]{40}(?:\s|$)/.test(line)) throw new Error(`workflow action is not SHA pinned: ${line.trim()}`);
}
if (!entrypoint.includes("_FILE") || !entrypoint.includes("setpriv --reuid=node --regid=node --init-groups") || !entrypoint.includes("EMAIL_SERVER_PORT")) {
  throw new Error("qualification entrypoint does not load and validate required files");
}
if (!start.includes("exec setpriv --reuid=node --regid=node --init-groups yarn start")) throw new Error("web process does not drop root after placeholder replacement");
if (workflow.includes("npx --yes ajv-cli")) throw new Error("CI downloads an unreviewed schema validator");
if (workflow.includes("aquasecurity/trivy-action@") || workflow.includes("/var/run/docker.sock")) {
  throw new Error("Trivy must run from the pinned official container without the Docker socket");
}
if (!workflow.includes("--allowlist deploy/qualification/trivy-secret-allowlist.json --root .")) {
  throw new Error("Trivy secret policy does not use the reviewed hash-bound allowlist");
}
if (secretAllowlist.schemaVersion !== "1.0.0" || secretAllowlist.sourceCommit !== "176037d0afbe572f870a3c702985e7cd83fe6c0c" || secretAllowlist.entries?.length !== 2) {
  throw new Error("Trivy secret allowlist does not match the frozen qualification source");
}
for (const entry of secretAllowlist.entries) {
  if (!/^[0-9a-f]{64}$/.test(entry.sha256 ?? "") || !entry.path || !entry.findings?.length || !entry.reason?.trim()) {
    throw new Error("Trivy secret allowlist entry is not path, hash, rule, and rationale bound");
  }
}
const nodeStages = dockerfile.split(/\r?\n/).filter((line) => line.startsWith("FROM ") && line.includes("node:"));
if (nodeStages.length !== 3 || nodeStages.some((line) => !line.includes("node:20.20.2-bookworm@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5"))) {
  throw new Error("every Node Docker stage must use the verified immutable multi-architecture digest");
}
if (!dockerfile.includes("RUN yarn install --immutable")) throw new Error("Docker build does not enforce the committed Yarn lockfile");
if (!dockerfile.includes("COPY apps ./apps") || !dockerfile.includes("COPY example-apps ./example-apps")) {
  throw new Error("immutable install does not receive the complete declared workspace graph");
}
if (!read(".dockerignore").includes("docs/**") || read(".dockerignore").split(/\r?\n/).includes("docs")) {
  throw new Error("Docker context excludes a declared documentation workspace");
}
for (const forbidden of ["npx", "apt-get", "wget", "gosu", "netcat-openbsd"]) {
  if (dockerfile.includes(forbidden)) throw new Error(`Dockerfile contains forbidden mutable/runtime package mechanism: ${forbidden}`);
}
if (!dockerfile.includes("RUN command -v setpriv")) throw new Error("pinned base does not prove its privilege-drop primitive");
if (/\bnpx\b/.test(entrypoint) || !entrypoint.includes("/calcom/node_modules/.bin/prisma") || !entrypoint.includes("/calcom/node_modules/.bin/ts-node")) {
  throw new Error("runtime maintenance commands are not confined to copied local binaries");
}
for (const required of ["sudo chown -R root:root", "sudo chmod 0700", "node -e \"fetch("]) {
  if (!workflow.includes(required)) throw new Error(`runtime smoke does not enforce ${required}`);
}
for (const file of [repository, processor]) {
  if (/console\.(?:info|warn|error).*payload|payload.*console\.(?:info|warn|error)/.test(file)) {
    throw new Error("touched Tasker path logs payload data");
  }
}
if (processor.includes("error.message") || !processor.includes("getTaskFailureClassification")) {
  throw new Error("Tasker persists raw failure detail instead of a safe classification");
}
console.log("qualification static verification passed");
