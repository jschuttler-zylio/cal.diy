import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

test("smoke ALLOWED_HOSTNAMES fixture matches the source JSON-element contract", async () => {
  const [workflow, constants] = await Promise.all([
    readFile(resolve(root, ".github/workflows/zylio-qualification-image.yml"), "utf8"),
    readFile(resolve(root, "packages/lib/constants.ts"), "utf8"),
  ]);
  const fixture = workflow.match(/printf '%s' '([^']*)' > "\$smoke_dir\/allowed-hostnames"/);

  assert.ok(fixture, "runtime smoke must write the ALLOWED_HOSTNAMES fixture");
  assert.match(
    constants,
    /ALLOWED_HOSTNAMES = JSON\.parse\(`\[\$\{process\.env\.ALLOWED_HOSTNAMES \|\| ""\}\]`\)/
  );
  assert.deepEqual(JSON.parse(`[${fixture[1]}]`), ["127.0.0.1:3000"]);
  assert.throws(
    () => JSON.parse("[127.0.0.1:3000]"),
    (error) => error instanceof SyntaxError && /position 6/.test(error.message)
  );
});
