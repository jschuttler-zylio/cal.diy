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
  assert.match(
    dockerfile,
    /node:20\.20\.2-bookworm@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5/
  );
  const finalRuntimePrune = dockerfile.indexOf("RUN find /calcom -depth -type d");
  const standaloneCopy = dockerfile.indexOf(
    "COPY --from=builder --chown=node:node /calcom/apps/web/.next/standalone ./"
  );
  assert.ok(finalRuntimePrune > standaloneCopy, "traced standalone output is pruned after it is copied");
  assert.match(dockerfile, /RUN find \/calcom -depth -type d[\s\S]*?-exec rm -rf \{\} \+/);
  assert.doesNotMatch(dockerfile, /--platform=\$BUILDPLATFORM/);
  assert.match(dockerfile, /RUN yarn workspaces focus @calcom\/web --production/);
  assert.doesNotMatch(dockerfile, /workspace @calcom\/embed-core run build/);
  assert.match(dockerfile, /workspace @calcom\/embed-core run tailwind/);
  assert.match(dockerfile, /yarn --cwd packages\/embeds\/embed-core vite build/);
  assert.match(dockerfile, /COPY --from=builder --chown=node:node \/calcom\/apps\/web\/.next\/standalone \./);
  assert.match(
    dockerfile,
    /COPY --from=runtime-deps --chown=node:node \/runtime-node_modules \.\/node_modules/
  );
  assert.match(
    dockerfile,
    /ln -s \.\.\/\.\.\/packages\/app-store \/runtime-node_modules\/@calcom\/app-store/
  );
  assert.match(dockerfile, /ln -s \.\.\/\.\.\/packages\/prisma \/runtime-node_modules\/@calcom\/prisma/);
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
