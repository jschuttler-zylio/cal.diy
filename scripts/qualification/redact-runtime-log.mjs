import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function redactRuntimeLog(input, runtimeValues) {
  let output = String(input);
  const values = [...new Set(runtimeValues.map(String).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const value of values) output = output.split(value).join("[REDACTED]");
  return output
    .replace(/\b(postgres(?:ql)?|https?):\/\/[^@\s/]+@/gi, "$1://[REDACTED]@")
    .replace(
      /\b(?:[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY))\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      (match, separator) => `${match.slice(0, match.indexOf(separator))}${separator}[REDACTED]`
    )
    .replace(/\bAuthorization\s*:\s*(?:Basic|Bearer)\s+\S+/gi, "Authorization: [REDACTED]");
}

async function runtimeValues(directory) {
  const secretFiles = new Set([
    "database-application",
    "database-migration",
    "nextauth-secret",
    "calendso-encryption-key",
    "cron-api-key",
    "cron-secret",
    "smtp-user",
    "smtp-password",
  ]);
  const entries = await readdir(directory, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && secretFiles.has(entry.name))
      .map((entry) => readFile(path.join(directory, entry.name), "utf8"))
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directoryIndex = process.argv.indexOf("--directory");
  if (directoryIndex < 0 || !process.argv[directoryIndex + 1])
    throw new Error("usage: redact-runtime-log.mjs --directory <runtime-directory>");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(redactRuntimeLog(input, await runtimeValues(process.argv[directoryIndex + 1])));
}

export { redactRuntimeLog, runtimeValues };
