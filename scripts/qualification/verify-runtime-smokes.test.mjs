import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const script = resolve(import.meta.dirname, "verify-runtime-smokes.mjs");
const amd64 = `sha256:${"a".repeat(64)}`;
const arm64 = `sha256:${"b".repeat(64)}`;
const run = (dir) =>
  spawnSync(process.execPath, [script, "--dir", dir, "--output", join(dir, "evidence.json"), "--amd64-digest", amd64, "--arm64-digest", arm64]);

test("requires matching, passing smoke records for both native platforms", () => {
  const dir = mkdtempSync(join(tmpdir(), "qualification-runtime-smoke-"));
  try {
    writeFileSync(join(dir, "runtime-smoke-amd64.json"), JSON.stringify({ platform: "linux/amd64", digest: amd64, runtimeSmoke: "pass" }));
    writeFileSync(join(dir, "runtime-smoke-arm64.json"), JSON.stringify({ platform: "linux/arm64", digest: arm64, runtimeSmoke: "pass" }));
    assert.equal(run(dir).status, 0);
    writeFileSync(join(dir, "runtime-smoke-arm64.json"), JSON.stringify({ platform: "linux/arm64", digest: arm64, runtimeSmoke: "fail" }));
    assert.notEqual(run(dir).status, 0);
    rmSync(join(dir, "runtime-smoke-arm64.json"));
    assert.notEqual(run(dir).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
