import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const commit = "176037d0afbe572f870a3c702985e7cd83fe6c0c";
const root = resolve(import.meta.dirname, "../..");
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const outArg = arg("--output");
if (!outArg) throw new Error("--output is required");
const built = process.argv.includes("--built");
const out = resolve(outArg);
const generatedAt = new Date().toISOString();
const read = (file) => readFileSync(resolve(root, file), "utf8");
const sha256 = (body) => createHash("sha256").update(body).digest("hex");
const routeFile = (route) => `apps/web/app${route}/route.ts`;
const routeExists = (route) => existsSync(resolve(root, routeFile(route)));

const required = new Map([
  ["DATABASE_URL", ["bitwarden", "secret", "zylioEnforced", "application database credential file"]],
  ["DATABASE_DIRECT_URL", ["bitwarden", "secret", "zylioEnforced", "migration database credential file"]],
  ["NEXTAUTH_SECRET", ["bitwarden", "secret", "zylioEnforced", "NextAuth signing secret file"]],
  ["CALENDSO_ENCRYPTION_KEY", ["bitwarden", "recovery-critical", "zylioEnforced", "credential encryption key file"]],
  ["CRON_API_KEY", ["bitwarden", "secret", "zylioEnforced", "cron raw-header credential file"]],
  ["CRON_SECRET", ["bitwarden", "secret", "zylioEnforced", "Tasker bearer credential file"]],
  ["NEXT_PUBLIC_WEBAPP_URL", ["tenant-manifest", "public", "zylioEnforced", "canonical hostname file"]],
  ["NEXTAUTH_URL", ["tenant-manifest", "public", "zylioEnforced", "canonical hostname file"]],
  ["ALLOWED_HOSTNAMES", ["tenant-manifest", "public", "zylioEnforced", "sealed allowed-host list file"]],
  ["CALCOM_TELEMETRY_DISABLED", ["literal", "public", "zylioEnforced", "must equal 1"]],
  ["TASKER_RETENTION_DAYS", ["literal", "public", "zylioEnforced", "integer range 7 through 3650"]],
  ["EMAIL_SERVER_HOST", ["literal", "public", "zylioEnforced", "Zylio SMTP submission host"]],
  ["EMAIL_SERVER_PORT", ["literal", "public", "zylioEnforced", "must equal SMTP submission port 587"]],
  ["EMAIL_SERVER_USER", ["bitwarden", "secret", "zylioEnforced", "materialized from smtp-credential purpose"]],
  ["EMAIL_SERVER_PASSWORD", ["bitwarden", "secret", "zylioEnforced", "materialized from smtp-credential purpose"]],
  ["EMAIL_FROM", ["literal", "public", "zylioEnforced", "Zylio-enforced sending identity"]],
  ["EMAIL_FROM_NAME", ["literal", "public", "zylioEnforced", "Zylio-enforced sender name"]],
  ["USE_POOL", ["literal", "public", "zylioEnforced", "must equal 1; source pool maximum is fixed at 5"]],
  ["NEXT_PUBLIC_DISABLE_SIGNUP", ["literal", "public", "zylioEnforced", "must equal true"]],
]);
const forbidden = new Set([
  "NEXT_PUBLIC_API_V2_URL",
  "API_PORT",
  "API_URL",
  "REDIS_URL",
  "ENABLE_ASYNC_TASKER",
  "TRIGGER_SECRET_KEY",
  "TRIGGER_API_URL",
  "TRIGGER_DEV_PROJECT_REF",
]);
const secretName = /(SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|DATABASE_URL|AUTH_BEARER|PRIVATE)/;
const envNames = new Set();
for (const source of [".env.example", "Dockerfile"]) {
  for (const line of read(source).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:ARG|ENV\s+)?([A-Z][A-Z0-9_]*)=/);
    if (match) envNames.add(match[1]);
  }
}
for (const name of required.keys()) envNames.add(name);
const variables = [...envNames]
  .sort()
  .map((name) => {
    const explicit = required.get(name);
    const isForbidden = forbidden.has(name);
    const source = explicit?.[0] ?? (secretName.test(name) ? "bitwarden" : "literal");
    const sensitivity = explicit?.[1] ?? (secretName.test(name) ? "secret" : "public");
    const ownership = explicit?.[2] ?? "zylioEnforced";
    return {
      name,
      requirement: explicit ? "required" : isForbidden ? "forbidden" : "conditional",
      source,
      sensitivity,
      ownership,
      profiles: ["base"],
      validation: explicit?.[3] ?? (isForbidden ? "unsupported by qualification web profile" : "source-inventory only; enable through an approved profile amendment"),
      sourceLocations: [".env.example", "Dockerfile", ...(explicit ? ["deploy/qualification/docker-compose.web.yml"] : [])],
    };
  });
const environment = { schemaVersion: "1.0.0", sourceCommit: commit, generatedAt, variables };

const vercel = JSON.parse(read("apps/web/vercel.json"));
const schedulerEntries = vercel.crons.map(({ path, schedule }) => {
  const sourcePath = routeFile(path);
  const route = read(sourcePath);
  const method = route.includes("export const GET") || route.includes("export async function GET") ? "GET" : "POST";
  const taskerRoute = path.startsWith("/api/tasks/");
  return {
    id: path.slice("/api/".length).replaceAll("/", "-"),
    route: path,
    method,
    auth: taskerRoute
      ? { scheme: "bearer", secretPurpose: "cron-secret" }
      : { scheme: "raw-header", secretPurpose: "cron-api-key" },
    schedule,
    timeoutSeconds: taskerRoute ? 300 : 120,
    maxAttempts: 3,
    overlapPolicy: "forbid-per-tenant",
    sourceLocations: ["apps/web/vercel.json", sourcePath],
  };
});
const scheduler = { schemaVersion: "1.0.0", sourceCommit: commit, generatedAt, entries: schedulerEntries };
const staleVercelRoutes = schedulerEntries.filter((entry) => !routeExists(entry.route)).map((entry) => entry.route);
const staleWorkflowRoutes = [];
for (const file of readdirSync(resolve(root, ".github/workflows"))) {
  if (!file.startsWith("cron-") || !file.endsWith(".yml")) continue;
  for (const match of read(`.github/workflows/${file}`).matchAll(/\/api\/(?:cron|tasks)\/[A-Za-z0-9_/-]+/g)) {
    if (!routeExists(match[0])) staleWorkflowRoutes.push({ file: `.github/workflows/${file}`, route: match[0] });
  }
}
const routeAudit = {
  sourceCommit: commit,
  generatedAt,
  status: staleVercelRoutes.length || staleWorkflowRoutes.length ? "fail" : "pass",
  staleVercelRoutes,
  staleWorkflowRoutes,
  note: "Source existence only; authenticated runtime verification remains Q3.",
};

function validateEnvironment(value) {
  if (value.schemaVersion !== "1.0.0" || value.sourceCommit !== commit || !Array.isArray(value.variables)) throw new Error("environment schema validation failed");
  for (const variable of value.variables) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(variable.name) || !["required", "conditional", "forbidden"].includes(variable.requirement)) throw new Error(`environment schema validation failed for ${variable.name}`);
  }
}
function validateScheduler(value) {
  if (value.schemaVersion !== "1.0.0" || value.sourceCommit !== commit || !Array.isArray(value.entries)) throw new Error("scheduler schema validation failed");
  for (const entry of value.entries) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id) || !entry.route.startsWith("/api/") || !["GET", "POST"].includes(entry.method)) throw new Error(`scheduler schema validation failed for ${entry.route}`);
  }
}
validateEnvironment(environment);
validateScheduler(scheduler);
mkdirSync(out, { recursive: true });
for (const [name, value] of Object.entries({ "environment-manifest.json": environment, "scheduler-manifest.json": scheduler, "route-audit.json": routeAudit })) writeFileSync(resolve(out, name), `${JSON.stringify(value, null, 2)}\n`);
if (!built) {
  writeFileSync(resolve(out, "UNBUILT.md"), `# Qualification image pending\n\nNo image manifest, SBOM, provenance, vulnerability result, or secret-scan pass is emitted locally. CI must produce both native platform digests and a digest-addressable OCI index.\n\nEnvironment SHA-256: ${sha256(JSON.stringify(environment))}\nScheduler SHA-256: ${sha256(JSON.stringify(scheduler))}\n`);
}
