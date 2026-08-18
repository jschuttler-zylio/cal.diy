import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { redactRuntimeLog, runtimeValues } from "./redact-runtime-log.mjs";

test("redacts every mounted value and credential-shaped fallback", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "qualification-redaction-"));
  await writeFile(path.join(directory, "database-application"), "postgresql://cal:cal@db:5432/calendso");
  await writeFile(path.join(directory, "nextauth-secret"), "test-nextauth-value");
  await writeFile(path.join(directory, "disable-signup"), "true");
  const output = redactRuntimeLog(
    "DATABASE_URL=postgresql://cal:cal@db:5432/calendso NEXTAUTH_SECRET=test-nextauth-value Authorization: Bearer extra-token https://user:password@example.invalid/path",
    await runtimeValues(directory)
  );
  assert.doesNotMatch(output, /cal:cal|test-nextauth-value|extra-token|user:password/);
  assert.ok((output.match(/\[REDACTED\]/g) ?? []).length >= 4);
  assert.match(
    redactRuntimeLog("sed: couldn't open temporary file sedtrue42: Permission denied", await runtimeValues(directory)),
    /sedtrue42/
  );
});
