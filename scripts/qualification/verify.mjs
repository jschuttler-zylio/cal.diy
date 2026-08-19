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
const nextConfig = read("apps/web/next.config.ts");
const webPackage = JSON.parse(read("apps/web/package.json"));
const prismaPackage = JSON.parse(read("packages/prisma/package.json"));
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
    "exec setpriv --reuid=node --regid=node --init-groups env PORT=3000 HOSTNAME=0.0.0.0 node apps/web/server.js"
  ) ||
  /\byarn\b|\bturbo\b/.test(start)
)
  throw new Error("web process does not drop root after placeholder replacement");
if (
  !nextConfig.includes('outputFileTracingRoot: path.join(__dirname, "../..")') ||
  !nextConfig.includes('output: process.env.BUILD_STANDALONE === "true" ? "standalone" : undefined')
) {
  throw new Error("Next standalone output is not rooted at the monorepo for runtime tracing");
}
if (
  webPackage.dependencies.next !== "16.2.11" ||
  webPackage.dependencies["next-auth"] !== "4.24.15" ||
  webPackage.dependencies.nodemailer !== "9.0.1" ||
  webPackage.dependencies.sharp !== "0.35.0" ||
  prismaPackage.dependencies["ts-node"] !== "10.9.2" ||
  prismaPackage.devDependencies["ts-node"]
) {
  throw new Error("scan-remediated runtime dependencies or maintenance closure are not pinned as reviewed");
}
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
for (const required of [
  'while [ "$attempt" -le 3 ]; do',
  'rm -f "$final" "$temp"',
  'test -s "$temp"',
  'mv "$temp" "$final"',
  'if [ "$attempt" -eq 3 ]; then',
]) {
  if ((workflow.match(new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length !== 2)
    throw new Error(`published-image Trivy retry contract is missing ${required}`);
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
  nodeStages.length !== 2 ||
  nodeStages.some(
    (line) =>
      !line.includes(
        "node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0"
      )
  )
) {
  throw new Error("every runtime Node stage must use the verified immutable slim multi-architecture digest");
}
if (/--platform=\$BUILDPLATFORM/.test(dockerfile))
  throw new Error("target image must not copy BUILDPLATFORM dependencies into the runtime");
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
for (const required of [
  "RUN yarn workspaces focus @calcom/web --production",
  "COPY --from=builder --chown=node:node /calcom/apps/web/.next/standalone ./",
  "COPY --from=builder --chown=node:node /calcom/apps/web/public ./apps/web/public",
  "COPY --from=builder --chown=node:node /calcom/apps/web/.next/static ./apps/web/.next/static",
  "COPY --from=runtime-deps --chown=node:node /runtime-node_modules ./node_modules",
  "COPY --from=builder --chown=node:node /calcom/packages/prisma ./packages/prisma",
  "COPY --from=builder --chown=node:node /calcom/packages/app-store ./packages/app-store",
  "rm -rf /runtime-node_modules/@calcom /runtime-node_modules/@coss",
]) {
  if (!dockerfile.includes(required)) throw new Error(`runtime COPY allowlist is missing ${required}`);
}
for (const forbidden of [
  "COPY --from=builder /calcom/node_modules",
  "COPY --from=builder /calcom/packages ./packages",
  "COPY --from=builder /calcom/apps/web ./apps/web",
  "COPY --from=builder-two",
]) {
  if (dockerfile.includes(forbidden))
    throw new Error(`runtime image copies an untraced closure: ${forbidden}`);
}
for (const forbiddenClosure of [
  "@depot",
  "trigger.dev",
  "@esbuild",
  "esbuild",
  "vite",
  "playwright",
  "@playwright",
]) {
  if (
    (dockerfile.match(new RegExp(forbiddenClosure.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? [])
      .length < 2
  )
    throw new Error(`runtime closure does not remove and assert ${forbiddenClosure}`);
}
if (!dockerfile.includes("! find /calcom -type d")) {
  throw new Error("runtime closure assertion does not cover traced standalone output and maintenance roots");
}
for (const required of [
  "chown -R root:root /calcom/apps/web/.next /calcom/apps/web/public",
  "find /calcom/apps/web/.next /calcom/apps/web/public -type d -exec chmod 0755 {} +",
  "find /calcom/apps/web/.next /calcom/apps/web/public -type f -exec chmod u=rwX,go=rX {} +",
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
  " seed-app-store",
  "api/auth/providers",
  "api/logo?type=favicon-16",
  "api/avatar/qualification-smoke",
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
