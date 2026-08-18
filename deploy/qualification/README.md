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

The image layer is intentionally writable because upstream's runtime URL
replacement mutates static output during startup. It has no authoritative or
persistent data mount: PostgreSQL and the root tmpfs secret directory remain
external. That incompatibility is a qualification constraint, not an ignored
hardening setting. SMTP is Zylio-enforced through file values: port `587` with
TLS/submission validation deferred to runtime, while its user/password are
materialized from the frozen `smtp-credential` Bitwarden purpose. `USE_POOL=1`
uses the source's fixed PostgreSQL pool maximum of five; public signup is fixed
to `NEXT_PUBLIC_DISABLE_SIGNUP=true`.

Every Docker build stage uses the same verified multi-architecture Node 20.20.2
Bookworm manifest digest. `yarn install --immutable` rejects any lockfile
change; the builder receives the complete declared workspace graph so a
partial Docker context cannot silently rewrite the lock. Each native build
runs the focused Tasker retention and failure-redaction tests before compiling
the web application. The frozen
source-image schema has no base-image field, so the OCI
BuildKit provenance and CycloneDX SBOM artifacts are the authoritative record
of this base digest and its resolved platform descriptors.

The native runtime smoke also pins PostgreSQL 16.10 Bookworm by its
multi-platform OCI index digest. The static qualification verifier checks that
exact pin, CI inspects the index for the native descriptor before building, and
Docker must resolve the matching AMD64 or ARM64 image on the corresponding
runner before migrations or web health can pass.

CI runs Trivy from an immutable official multi-platform container digest and
forces registry-only image resolution; the scanner never receives the host
Docker socket. Raw JSON and SBOM output are collected before policy evaluation.
The read-only source secret job must pass before either native image build may
publish, and each job receives only its required GitHub token permissions.
Malformed output, any HIGH/CRITICAL vulnerability, or any unexpected secret
finding blocks the image manifest, while the raw reports remain downloadable
for review. The only secret exceptions are inherited upstream documentation/test
fixtures matched by exact path, rule count, and frozen file hash in
`trivy-secret-allowlist.json`; a changed or additional finding fails closed.

The pinned Debian base must provide `setpriv`; the image build fails immediately
if it does not. `setpriv` drops the root bootstrap process to `node` after URL
replacement, avoiding a mutable apt package install. Health checks use Node's
built-in `fetch`, so the image carries no additional probe client.

Migrations and app-store seeding require `--profile maintenance` and use the
same entrypoint and secret-file loader as web. They are never web startup work.

Task cleanup retains succeeded and exhausted tasks for `TASKER_RETENTION_DAYS`;
the enforced range is 7–3650 days and the safe fallback is 30 days. The cleanup
endpoint returns both its deletion count and retained terminal-task counts.
The deployment scheduler must provide the one external Tasker consumer per
tenant. This source slice intentionally does not claim transactional task rows.
