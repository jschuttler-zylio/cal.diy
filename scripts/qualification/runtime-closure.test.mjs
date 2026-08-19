import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

test("runtime image is target-native, traced, and excludes build/test closures", async () => {
  const [dockerfile, start, nextConfig] = await Promise.all([
    readFile(resolve(root, "Dockerfile"), "utf8"),
    readFile(resolve(root, "scripts/qualification-web-start.sh"), "utf8"),
    readFile(resolve(root, "apps/web/next.config.ts"), "utf8"),
  ]);

  assert.match(
    dockerfile,
    /node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0/
  );
  assert.doesNotMatch(dockerfile, /--platform=\$BUILDPLATFORM/);
  assert.match(dockerfile, /RUN yarn workspaces focus @calcom\/web --production/);
  assert.match(dockerfile, /COPY --from=builder --chown=node:node \/calcom\/apps\/web\/.next\/standalone \./);
  assert.match(
    dockerfile,
    /COPY --from=runtime-deps --chown=node:node \/runtime-node_modules \.\/node_modules/
  );
  assert.doesNotMatch(dockerfile, /COPY --from=builder \/calcom\/node_modules/);
  assert.doesNotMatch(dockerfile, /COPY --from=builder \/calcom\/packages \.\/packages/);
  assert.match(dockerfile, /! find \/calcom -type d/);
  for (const closure of [
    "@depot",
    "trigger.dev",
    "@esbuild",
    "esbuild",
    "vite",
    "playwright",
    "@playwright",
  ]) {
    assert.ok(
      (dockerfile.match(new RegExp(closure.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length ?? 0) >= 2,
      closure
    );
  }
  assert.match(nextConfig, /outputFileTracingRoot: path\.join\(__dirname, "\.\.\/\.\."\)/);
  assert.match(start, /node apps\/web\/server\.js/);
  assert.doesNotMatch(start, /\byarn\b|\bturbo\b/);
});
