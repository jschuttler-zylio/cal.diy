import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./verify-oci-platforms.mjs", import.meta.url));
const fixture = JSON.stringify({
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.index.v1+json",
  manifests: [
    { digest: `sha256:${"a".repeat(64)}`, platform: { os: "linux", architecture: "amd64" } },
    { digest: `sha256:${"b".repeat(64)}`, platform: { os: "linux", architecture: "arm64", variant: "v8" } },
  ],
});

const run = (platform, input = fixture) => spawnSync(process.execPath, [script, "--platform", platform], {
  input,
  encoding: "utf8",
});

test("accepts exact native descriptors from a multi-platform OCI index", () => {
  assert.equal(run("linux/amd64").status, 0);
  assert.equal(run("linux/arm64").status, 0);
  assert.equal(run("linux/arm64/v8").status, 0);
});

test("rejects a platform-specific manifest or the wrong architecture", () => {
  const noIndex = JSON.stringify({ schemaVersion: 2, platform: { os: "linux", architecture: "386" } });
  assert.notEqual(run("linux/arm64", noIndex).status, 0);
  const wrongArchitecture = run("linux/386");
  assert.notEqual(wrongArchitecture.status, 0);
  assert.match(wrongArchitecture.stderr, /does not contain linux\/386/);
});
