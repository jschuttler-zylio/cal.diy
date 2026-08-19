import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";

const root = resolve(import.meta.dirname, "../..");
const execFileAsync = promisify(execFile);

test("runtime image is target-native, traced, and excludes build/test closures", async () => {
  const [dockerfile, start, nextConfig, googleCalendarMetadata] = await Promise.all([
    readFile(resolve(root, "Dockerfile"), "utf8"),
    readFile(resolve(root, "scripts/qualification-web-start.sh"), "utf8"),
    readFile(resolve(root, "apps/web/next.config.ts"), "utf8"),
    readFile(resolve(root, "packages/app-store/googlecalendar/_metadata.ts"), "utf8"),
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
  assert.match(dockerfile, /ln -s \.\.\/\.\.\/packages\/prisma \/runtime-node_modules\/@calcom\/prisma/);
  assert.match(
    dockerfile,
    /COPY --from=builder --chown=node:node \/calcom\/\.qualification\/seed\/seed-app-store\.cjs \.\/scripts\/seed-app-store\.cjs/
  );
  assert.match(googleCalendarMetadata, /from "@calcom\/lib\/jsonUtils"/);
  const maintenanceCopies = [
    ...dockerfile.matchAll(
      /COPY --from=builder --chown=node:node \/calcom\/packages\/([^\s]+) \.\/packages\//g
    ),
  ].map((match) => match[1]);
  assert.deepEqual(maintenanceCopies, ["prisma"]);
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

test("the seed bundle resolves the full metadata closure and externalizes only Prisma", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "calcom-maintenance-closure-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));

  const requireFromEmbed = createRequire(resolve(root, "packages/embeds/embed-core/package.json"));
  const viteCli = resolve(dirname(requireFromEmbed.resolve("vite/package.json")), "bin/vite.js");
  const buildBundle = (outDir) =>
    execFileAsync(
      process.execPath,
      [
        viteCli,
        "build",
        "--config",
        resolve(root, "scripts/qualification/seed-bundle.config.mjs"),
        "--outDir",
        outDir,
      ],
      { cwd: root }
    );
  const firstBuild = join(fixture, "first");
  const secondBuild = join(fixture, "second");
  await buildBundle(firstBuild);
  await buildBundle(secondBuild);

  const bundlePath = join(firstBuild, "seed-app-store.cjs");
  const bundle = await readFile(bundlePath, "utf8");
  assert.equal(bundle, await readFile(join(secondBuild, "seed-app-store.cjs"), "utf8"));
  assert.doesNotMatch(bundle, /@calcom\/(?:app-store|lib|types)/);
  assert.match(bundle, /require\(["']@calcom\/prisma["']\)/);
  assert.match(bundle, /require\(["']@calcom\/prisma\/enums["']\)/);
  const externalRequires = [
    ...new Set([...bundle.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map((match) => match[1])),
  ].sort();
  assert.deepEqual(externalRequires, [
    "@calcom/prisma",
    "@calcom/prisma/enums",
    "crypto",
    "fs",
    "node:path",
    "node:process",
    "os",
    "path",
  ]);

  const prismaModule = join(firstBuild, "node_modules", "@calcom", "prisma");
  await mkdir(prismaModule, { recursive: true });
  await writeFile(
    join(prismaModule, "index.js"),
    "exports.prisma = { app: {}, credential: {}, $disconnect: async () => {} };\n"
  );
  await writeFile(join(prismaModule, "enums.js"), "exports.AppCategories = {};\n");
  await execFileAsync(process.execPath, ["-e", "require(process.argv[1])", bundlePath], {
    cwd: firstBuild,
  });
});
