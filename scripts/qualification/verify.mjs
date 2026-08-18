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
const runtimeLogRedactor = read("scripts/qualification/redact-runtime-log.mjs");
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
const runtimeSmokeFiles = {
  DATABASE_URL: "database-application",
  DATABASE_DIRECT_URL: "database-migration",
  NEXTAUTH_SECRET: "nextauth-secret",
  CALENDSO_ENCRYPTION_KEY: "calendso-encryption-key",
  CRON_API_KEY: "cron-api-key",
  CRON_SECRET: "cron-secret",
  NEXT_PUBLIC_WEBAPP_URL: "canonical-url",
  NEXTAUTH_URL: "canonical-url",
  ALLOWED_HOSTNAMES: "allowed-hostnames",
  CALCOM_TELEMETRY_DISABLED: "telemetry-disabled",
  TASKER_RETENTION_DAYS: "tasker-retention-days",
  EMAIL_SERVER_HOST: "smtp-host",
  EMAIL_SERVER_PORT: "smtp-port",
  EMAIL_SERVER_USER: "smtp-user",
  EMAIL_SERVER_PASSWORD: "smtp-password",
  EMAIL_FROM: "smtp-from",
  EMAIL_FROM_NAME: "smtp-from-name",
  USE_POOL: "use-pool",
  NEXT_PUBLIC_DISABLE_SIGNUP: "disable-signup",
};
for (const required of [
  "@sha256",
  "profiles: [maintenance]",
  "cap_drop: [ALL]",
  "DATABASE_URL_FILE",
  "tenant-egress",
  "external-proxy",
]) {
  if (!compose.includes(required)) throw new Error(`qualification compose missing ${required}`);
}
for (const forbidden of ["redis", "calcom-api", "studio", "ports:", "env_file:"]) {
  if (compose.includes(forbidden)) throw new Error(`qualification compose contains forbidden ${forbidden}`);
}
if (/x-hardening:[\s\S]*?read_only:\s*true/.test(compose))
  throw new Error("Compose claims read-only despite URL replacement");
if (!profileDocs.includes("intentionally writable") || !profileDocs.includes("persistent data mount")) {
  throw new Error("writable runtime exception is not documented");
}
for (const name of requiredFiles) {
  if (!entrypoint.includes(name) || !compose.includes(`${name}_FILE`))
    throw new Error(`missing file-backed runtime mapping: ${name}`);
  const runtimePath = `/run/zylio-booking/ci/${runtimeSmokeFiles[name]}`;
  if (!workflow.includes(`-e ${name}_FILE=${runtimePath}`)) {
    throw new Error(`native runtime smoke missing exact file mapping: ${name}_FILE=${runtimePath}`);
  }
}
for (const forbidden of ["migrate deploy", "seed-app-store"]) {
  if (start.includes(forbidden)) throw new Error(`web startup mutates database: ${forbidden}`);
}
for (const required of [
  "cancel-in-progress: true",
  "needs: secret-scan",
  "linux/amd64",
  "linux/arm64",
  "provenance: mode=max",
  "sbom: true",
  "gitleaks/gitleaks-action@",
  "TRIVY_IMAGE: ghcr.io/aquasecurity/trivy@sha256:a22415a38938a56c379387a8163fcb0ce38b10ace73e593475d3658d578b2436",
  "--image-src remote",
  '--platform "$platform" --scanners vuln,secret',
  "assemble-scan-evidence.mjs",
  "enforce-trivy-report.mjs",
  "generate-manifests.mjs --output qualification-artifacts --built",
  "write-image-manifest.mjs",
  "Runtime smoke on the native runner with PostgreSQL",
  'redact-runtime-log.mjs --directory "$smoke_dir"',
  "verify-contract-hashes.mjs",
  "validate-manifests.mjs",
  "verify-runtime-smokes.mjs",
  `verify-oci-platforms.mjs --platform "\${{ matrix.platform }}"`,
  "SMOKE_POSTGRES_IMAGE: docker.io/library/postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74",
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
if (
  !/permissions:\s*\r?\n\s+contents: read\s*\r?\n\s+packages: write\s*\r?\n\s+id-token: write\s*\r?\n\s+attestations: write/.test(
    workflow
  )
) {
  throw new Error("image build job lacks least-privilege package and attestation permissions");
}
if (!/secret-scan:\s*\r?\n\s+permissions:\s*\r?\n\s+contents: read/.test(workflow)) {
  throw new Error("secret scan job permissions are not read-only");
}
for (const line of workflow.split(/\r?\n/).filter((line) => line.includes("uses:"))) {
  if (!/@[0-9a-f]{40}(?:\s|$)/.test(line))
    throw new Error(`workflow action is not SHA pinned: ${line.trim()}`);
}
if (
  !entrypoint.includes("_FILE") ||
  !entrypoint.includes("setpriv --reuid=node --regid=node --init-groups") ||
  !entrypoint.includes("EMAIL_SERVER_PORT")
) {
  throw new Error("qualification entrypoint does not load and validate required files");
}
if (
  !start.includes(
    "exec setpriv --reuid=node --regid=node --init-groups env HOME=/home/node XDG_CONFIG_HOME=/home/node/.config yarn start --cache-dir /home/node/.cache/turbo"
  )
)
  throw new Error("web process does not drop root after placeholder replacement");
if (workflow.includes("npx --yes ajv-cli")) throw new Error("CI downloads an unreviewed schema validator");
if (workflow.includes("aquasecurity/trivy-action@") || workflow.includes("/var/run/docker.sock")) {
  throw new Error("Trivy must run from the pinned official container without the Docker socket");
}
if (!workflow.includes("--allowlist deploy/qualification/trivy-secret-allowlist.json --root .")) {
  throw new Error("Trivy secret policy does not use the reviewed hash-bound allowlist");
}
if ((workflow.match(/--timeout 20m/g) ?? []).length !== 2) {
  throw new Error("published-image Trivy scan and SBOM export must each use the bounded timeout");
}
if (!workflow.includes(`printf '%s' '"127.0.0.1:3000"' > "$smoke_dir/allowed-hostnames"`)) {
  throw new Error("runtime smoke must provide ALLOWED_HOSTNAMES as a JSON string element");
}
if (
  secretAllowlist.schemaVersion !== "1.0.0" ||
  secretAllowlist.sourceCommit !== "176037d0afbe572f870a3c702985e7cd83fe6c0c" ||
  secretAllowlist.entries?.length !== 2
) {
  throw new Error("Trivy secret allowlist does not match the frozen qualification source");
}
for (const entry of secretAllowlist.entries) {
  if (
    !/^[0-9a-f]{64}$/.test(entry.sha256 ?? "") ||
    !entry.path ||
    !entry.findings?.length ||
    !entry.reason?.trim()
  ) {
    throw new Error("Trivy secret allowlist entry is not path, hash, rule, and rationale bound");
  }
}
const nodeStages = dockerfile
  .split(/\r?\n/)
  .filter((line) => line.startsWith("FROM ") && line.includes("node:"));
if (
  nodeStages.length !== 3 ||
  nodeStages.some(
    (line) =>
      !line.includes(
        "node:20.20.2-bookworm@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5"
      )
  )
) {
  throw new Error("every Node Docker stage must use the verified immutable multi-architecture digest");
}
if (!dockerfile.includes("RUN yarn install --immutable"))
  throw new Error("Docker build does not enforce the committed Yarn lockfile");
if (
  !dockerfile.includes(
    "RUN yarn vitest run packages/features/tasker/internal-tasker.test.ts packages/features/tasker/task-processor.test.ts"
  )
) {
  throw new Error("Docker build does not execute the qualification Tasker tests");
}
if (!dockerfile.includes("COPY apps ./apps") || !dockerfile.includes("COPY example-apps ./example-apps")) {
  throw new Error("immutable install does not receive the complete declared workspace graph");
}
if (!read(".dockerignore").includes("docs/**") || read(".dockerignore").split(/\r?\n/).includes("docs")) {
  throw new Error("Docker context excludes a declared documentation workspace");
}
for (const forbidden of ["npx", "apt-get", "wget", "gosu", "netcat-openbsd"]) {
  if (dockerfile.includes(forbidden))
    throw new Error(`Dockerfile contains forbidden mutable/runtime package mechanism: ${forbidden}`);
}
if (!dockerfile.includes("RUN command -v setpriv"))
  throw new Error("pinned base does not prove its privilege-drop primitive");
if (!dockerfile.includes("COPY --from=builder-two --chown=node:node /calcom ./"))
  throw new Error("runtime tree is not owned by the non-root web user");
for (const required of [
  "chown -R root:root /calcom/apps/web/.next /calcom/apps/web/public",
  "find /calcom/apps/web/.next /calcom/apps/web/public -type d -exec chmod 0755 {} +",
  "find /calcom/apps/web/.next /calcom/apps/web/public -type f -exec chmod u=rwX,go=rX {} +",
  "mkdir -p /home/node/.cache/turbo",
  "chown node:node /home/node/.cache /home/node/.cache/turbo",
  "chmod 0700 /home/node/.cache /home/node/.cache/turbo",
]) {
  if (!dockerfile.includes(required))
    throw new Error(`runtime URL replacement ownership boundary is missing ${required}`);
}
if (/DAC_OVERRIDE/.test(`${dockerfile}\n${workflow}`))
  throw new Error("qualification runtime must not add DAC_OVERRIDE to bypass file ownership");
if (!runtimeLogRedactor.includes("redactRuntimeLog") || !runtimeLogRedactor.includes("readdir"))
  throw new Error("runtime smoke failure logs are not value-redacted");
if (!runtimeLogRedactor.includes("secretFiles"))
  throw new Error("runtime smoke redactor does not limit literal replacement to secret files");
if (
  /\bnpx\b/.test(entrypoint) ||
  !entrypoint.includes("/calcom/node_modules/.bin/prisma") ||
  !entrypoint.includes("/calcom/node_modules/.bin/ts-node")
) {
  throw new Error("runtime maintenance commands are not confined to copied local binaries");
}
for (const required of [
  "sudo chown -R root:root",
  "sudo chmod 0700",
  "-exec chmod 0400 {} +",
  'node -e "fetch(',
]) {
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
