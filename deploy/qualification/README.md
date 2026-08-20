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

The builder and published runner use the verified multi-architecture
`node:24.19.0-trixie-slim` manifest digest
`sha256:0711b541c1c33a8a530ac4f0d391baa9a15b3d804695b1b24a47daa5fb60e74d`.
This is the current Node LTS line on the current Debian stable generation. The
builder adds only `g++`, `make`, `python3`, and `unzip` for upstream native
install hooks; none crosses into the runner. The runner applies Debian stable
updates, then removes package-manager metadata and the bundled npm/Corepack
trees because no runtime entrypoint uses them. No stage is pinned to
`BUILDPLATFORM`: each native runner installs and builds its own
target-architecture dependencies. The build probes deasync, Sharp, and the
Sentry CPU profiler on the native target before compiling the application.
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
`yarn workspaces focus @calcom/prisma --production` supplies only the migration
and seed dependency closure under `/calcom/maintenance`; it never overlays the
standalone web tree. The final image explicitly removes and asserts the absence
of Depot, the Trigger CLI, esbuild, Vite, and Playwright across both roots. It
also removes the duplicate web-traced Prisma CLI configuration packages after
proving that the isolated maintenance copies remain. Next 16's exact nested
SWC helper is restored from the immutable builder graph because output tracing
does not emit that payload, and the build asserts its reviewed version and
entry module before publication. Prisma migration keeps its narrow local source
root plus the local `prisma` binary. App-store seeding is compiled during the
builder stage into one deterministic CommonJS maintenance artifact using the
workspace-pinned Vite toolchain. That bundle resolves the complete static
app-store/lib/type metadata graph at build time and externalizes only Node
built-ins and `@calcom/prisma`; the maintenance path therefore adds neither an
app-store nor a lib source tree to the runner. The sole restored maintenance
workspace alias is `@calcom/prisma`, and the seed loads that TypeScript root
through the copied local `ts-node` register hook. The focused install is handed
directly between Docker stages so Yarn's nested package content is not
reconstructed through an intermediate copy; both stages assert the exact
nested adapter utility used by the seed's Prisma client.
Yarn's production focus currently retains the exact 6.16.1 nested adapter
package metadata without its `dist` payload. The build restores only that
package from the immutable install's checksum-verified cache archive, named
exactly in the Dockerfile, and fails before publication if either side of the
stage handoff lacks its executable module.
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
Malformed output, any unexpected HIGH/CRITICAL vulnerability, or any unexpected
secret finding blocks the image manifest, while the raw reports remain
downloadable for review. Fixable runtime findings are upgraded or removed; they
are not excepted. A remaining vulnerability can pass only through
`trivy-vulnerability-allowlist.json`, which binds the exact vulnerability,
package and installed/fixed versions, severity, upstream status, both native
platforms, occurrence count, CycloneDX SBOM path, and reviewed reachability
rationale. The policy records the CISA KEV catalog version reviewed and expires
after 90 days; a changed package, path, finding, platform, count, or expired
review fails closed. The only secret exceptions are inherited upstream
documentation/test fixtures matched by exact path, rule count, and frozen file
hash in `trivy-secret-allowlist.json`; a changed or additional finding also
fails closed.
The builder runs those tests before compile, but strips `apps/web/playwright`
from the runtime handoff stage: E2E sources are not runtime dependencies and
must not turn those reviewed source-only fixture exceptions into embedded image
secrets.

The pinned Debian base must provide `setpriv`; the image build fails immediately
if it does not. `setpriv` drops the root bootstrap process to `node` after URL
replacement, avoiding a mutable apt package install. The runtime tree is owned
by `node` except the two bounded placeholder targets. A failed native smoke
emits only a bounded log tail after replacing every mounted runtime-file value
and credential-shaped URI segment. The smoke alone opts into an 8 KiB-bounded
server request diagnostic and emits status-only results for the root,
auth-provider, logo, and avatar probes when either readiness or the final route
contract fails. It classifies the logo content type only as image/non-image and
never emits a body or header value; the deployed profile never enables the
server-error flag. Health checks use Node's built-in `fetch`, so the image carries
no additional probe client.

The standalone build deliberately retains
`http://NEXT_PUBLIC_WEBAPP_URL_PLACEHOLDER`. The final runner records that exact
compiled source as `BUILT_NEXT_PUBLIC_WEBAPP_URL`; startup replaces it with the
file-materialized tenant URL before dropping privileges. It must not claim the
runner ARG default was compiled into the standalone output.

Migrations and app-store seeding require `--profile maintenance` and use the
same entrypoint and secret-file loader as web. They are never web startup work.

Task cleanup retains succeeded and exhausted tasks for `TASKER_RETENTION_DAYS`;
the enforced range is 7–3650 days and the safe fallback is 30 days. The cleanup
endpoint returns both its deletion count and retained terminal-task counts.
The deployment scheduler must provide the one external Tasker consumer per
tenant. This source slice intentionally does not claim transactional task rows.
