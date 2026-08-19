# Qualification web profile

`docker-compose.web.yml` runs only the Cal.diy web workload. PostgreSQL,
reverse proxy, OAuth, SMTP, calendar-provider, and other required external
egress are reached through the tenant egress network. The web service also
joins the per-tenant unique reverse-proxy network supplied through
`BOOKING_PROXY_NETWORK`; it never publishes a host port.

`booking-ops` materializes the sole bind source, `CALDIY_SECRET_DIR`, as the
root-owned `/run/zylio-booking/<tenant>` tmpfs directory. Every runtime value,
including public hostname controls, is read through an explicit `*_FILE` path;
the Compose file does not interpolate a value or receive a `.env` file.
`ALLOWED_HOSTNAMES` is a comma-separated sequence of JSON string literals
without enclosing brackets: the source wraps the value in its own array before
parsing it.

The image layer is intentionally writable because upstream's runtime URL
replacement mutates static output during startup. It has no authoritative or
persistent data mount: PostgreSQL and the root tmpfs secret directory remain
external. That incompatibility is a qualification constraint, not an ignored
hardening setting. SMTP is Zylio-enforced through file values: port `587` with
TLS/submission validation deferred to runtime, while its user/password are
materialized from the frozen `smtp-credential` Bitwarden purpose. `USE_POOL=1`
uses the source's fixed PostgreSQL pool maximum of five; public signup is fixed
to `NEXT_PUBLIC_DISABLE_SIGNUP=true`.

The final image otherwise remains node-owned. Only the upstream replacement
targets, `apps/web/.next` and `apps/web/public`, are root-owned with directories
mode `0755` and files `u=rwX,go=rX`. This allows the capability-dropped startup
root to create `sed` temporary files and atomically replace matching assets;
the web server then drops to `node`, which retains read/execute access only. Its
launch uses the traced Next standalone server directly, so it carries no runtime
Yarn, Turbo, or writable build cache. It does not make `/calcom` or its built
assets writable to the web process.
The profile does not add `DAC_OVERRIDE` or make any runtime path world-writable.

The published runner uses the verified multi-architecture
`node:20-bookworm-slim` manifest digest
`sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0`
(the inspected AMD64 descriptor reports Node 20.20.2). The target-native builder
uses a separately verified immutable full-Bookworm Node 20.20.2 index digest
`sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5`:
it supplies the upstream native-install toolchain, while that larger base never
crosses into the published image. No stage is pinned to `BUILDPLATFORM`: each
native runner installs and builds its own target-architecture dependencies.
`yarn install --immutable` rejects any lockfile change; the builder receives the
complete declared workspace graph so a partial Docker context cannot silently
rewrite the lock. Each native build runs the focused Tasker retention and
failure-redaction tests before compiling the web application. The frozen
source-image schema has no base-image field, so the OCI
BuildKit provenance and CycloneDX SBOM artifacts are the authoritative record
of this base digest and its resolved platform descriptors.

The embed asset build calls the lockfile-installed Tailwind, Vite, and TypeScript
binaries directly. It deliberately bypasses an upstream aggregate script that
uses `npx`, so the Docker build has no mutable package fetch after its immutable
Yarn install.

The runner is not a copy of the builder. Next standalone output, rooted at the
monorepo for output tracing, supplies the web runtime. A target-native
`yarn workspaces focus @calcom/web --production` supplies only the production
external dependency closure; the final image explicitly removes and asserts the
absence of Depot, the Trigger CLI, esbuild, Vite, and Playwright across both the
focused closure and traced output. Prisma
migration and app-store seed keep only their narrow local maintenance roots
(`packages/prisma`, `packages/app-store`, local `prisma`, and local `ts-node`).
The seed also needs the declared `@calcom/lib/jsonUtils` helper while evaluating
app-store metadata, so it receives exactly that source module, not the `lib`
package or any additional workspace closure. The only restored workspace module
aliases are `@calcom/prisma`, `@calcom/app-store`, and `@calcom/lib`; each points
at those copied maintenance roots so the local seed entrypoint can resolve its
declared imports without restoring the full workspace tree.
The native smoke runs migration, app-store seed, the standalone web server, a
public auth API request, a dynamic logo/image request, and an avatar fallback
route against PostgreSQL before it can report `runtimeSmoke: pass`.

The native runtime smoke also pins PostgreSQL 16.10 Bookworm by its
multi-platform OCI index digest. The static qualification verifier checks that
exact pin, CI inspects the index for the native descriptor before building, and
Docker must resolve the matching AMD64 or ARM64 image on the corresponding
runner before migrations or web health can pass. Because the smoke invokes
Docker directly rather than Compose, it passes the same exact nineteen
`*_FILE` mappings to both the migration and web containers; the static verifier
checks those paths against the runtime contract.

CI runs Trivy from an immutable official multi-platform container digest and
forces registry-only image resolution; the scanner never receives the host
Docker socket. It scans the published AMD64 and ARM64 descriptors separately
for vulnerabilities and embedded secrets, retains both raw reports, and
assembles platform-labelled policy evidence. Raw JSON and SBOM output are
collected before policy evaluation. The published-image scan and SBOM export
each have a bounded 20-minute Trivy analysis timeout; reaching that deadline
fails the workflow rather than suppressing scan coverage.
Remote transport failures are retried at most three times for each platform
scan and for the SBOM export. Each attempt writes a fresh temporary file and
only atomically publishes a non-empty result; exhaustion remains a terminal
workflow failure before raw evidence or policy enforcement can proceed.
The read-only source secret job must pass before either native image build may
publish, and each job receives only its required GitHub token permissions.
Malformed output, any HIGH/CRITICAL vulnerability, or any unexpected secret
finding blocks the image manifest, while the raw reports remain downloadable
for review. The only secret exceptions are inherited upstream documentation/test
fixtures matched by exact path, rule count, and frozen file hash in
`trivy-secret-allowlist.json`; a changed or additional finding fails closed.
The builder runs those tests before compile, but strips `apps/web/playwright`
from the runtime handoff stage: E2E sources are not runtime dependencies and
must not turn those reviewed source-only fixture exceptions into embedded image
secrets.

The pinned Debian base must provide `setpriv`; the image build fails immediately
if it does not. `setpriv` drops the root bootstrap process to `node` after URL
replacement, avoiding a mutable apt package install. The runtime tree is owned
by `node` except the two bounded placeholder targets. A failed native smoke
emits only a bounded log tail after replacing every mounted runtime-file value
and credential-shaped URI segment. Health checks use Node's built-in `fetch`,
so the image carries no additional probe client.

Migrations and app-store seeding require `--profile maintenance` and use the
same entrypoint and secret-file loader as web. They are never web startup work.

Task cleanup retains succeeded and exhausted tasks for `TASKER_RETENTION_DAYS`;
the enforced range is 7–3650 days and the safe fallback is 30 days. The cleanup
endpoint returns both its deletion count and retained terminal-task counts.
The deployment scheduler must provide the one external Tasker consumer per
tenant. This source slice intentionally does not claim transactional task rows.
