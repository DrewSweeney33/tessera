# ADR-004: Container and Base Image

**Status:** Accepted
**Date:** 2026-10-10
**Feature:** tessera-v1
**Author:** 10x-Team (Architect + Staff Engineer)

## Context

Tessera ships as a Docker image that must run on the owner's homelab (amd64) and on common self-host hardware (arm64 mini PCs, Raspberry Pi). The spec's success criteria include a small image and a healthy start in under 10 seconds. The earlier risk was that `better-sqlite3` might need compilation on slim images or arm64. Docker is not installed on the development machine, so the image is first built in CI.

Verified on 2026-10-10:

- `better-sqlite3` 13.0.3 ships prebuilt N-API binaries inside the npm package: `linux-x64`, `linux-arm64`, `linuxmusl-x64`, `linuxmusl-arm64`, plus macOS and Windows. It installed and loaded on Windows and Node 24 in about 2 seconds with no compiler. N-API binaries are ABI stable across Node versions.
- Docker Hub `node` image, compressed sizes: `24-bookworm-slim` 77 MB, `24-trixie-slim` 79 MB, `24-alpine` 59 MB. All three publish amd64 and arm64. Current tags `24-trixie-slim`, `24-bookworm-slim` and `24-alpine` were updated in September and October 2026.

## Decision

1. **Base image:** `node:24-trixie-slim` (Debian 13, glibc) for both build and runtime stages.
2. **Multi-stage Dockerfile:**
   - Build stage: `npm ci`, `npm run build`, then `npm prune --omit=dev`.
   - Runtime stage: copy `build/`, pruned `node_modules/`, `package.json`, and `drizzle/`. No compiler, no dev dependencies, no source.
3. **Process:** `node build/index.js` as user `node` (uid 1000). `NODE_ENV=production`, `DATA_DIR=/data`, `PORT=3000`, `HOST=0.0.0.0`, `BODY_SIZE_LIMIT=5M`. The `/data` directory is declared a `VOLUME`.
4. **Signals:** `adapter-node` shuts down gracefully on SIGTERM. The sample `compose.yaml` sets `init: true` so signals and zombie reaping behave. The app closes the SQLite connection on shutdown.
5. **Health:** `HEALTHCHECK` runs a tiny Node one-liner against `/healthz` because the slim image has no `curl`. `/healthz` checks that the database answers a trivial query.
6. **Writable path check:** on boot the app verifies `DATA_DIR` is writable and prints a clear message naming the expected uid (1000) and a `chown` hint if not.
7. **Publishing:** GitHub Actions builds `linux/amd64` and `linux/arm64` with Buildx and pushes to GHCR as `:edge` (main), `:<semver>`, and `:latest` (releases only). Initially built under QEMU for arm64. Move to a native arm64 runner if the build is slow.
8. **Size target:** compressed manifest size under 150 MB per architecture, measured in CI and recorded in the release notes. This replaces the spec's undefined "250 MB" with a defined metric.
9. **Sample compose file:** published port bound to loopback by default (`127.0.0.1:3000:3000`), `read_only: true` root filesystem, `tmpfs` for `/tmp`, `cap_drop: [ALL]`, `security_opt: no-new-privileges:true`, a named volume for `/data`.
10. **Base image updates:** Dependabot tracks the Dockerfile base tag. The runtime stage may later pin by digest.

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| `node:24-alpine` (musl) | Smallest (59 MB compressed), prebuilt musl binaries exist | musl differences affect DNS resolution, memory allocator behavior, and some native modules. Harder to debug for new contributors. | Savings of about 20 MB do not justify musl edge cases. |
| `node:24-bookworm-slim` | Same as trixie, longer-known | Debian 12 is oldstable | Trixie is current stable and equally small. |
| Distroless Node | Smaller attack surface, no shell | No shell makes debugging and health checks harder, less familiar to self-hosters | Reconsider post-v1 if hardening matters more than debuggability. |
| Compile `better-sqlite3` from source in the image | Not tied to prebuilds | Needs build tools, slower builds, larger build stage | Unnecessary since prebuilds are bundled. |
| Single executable (`node --sea`) | One file | Native addon packaging complexity, loses easy base-image updates | Over-engineering for v1. |
| Run as root | Avoids volume permission friction | Unnecessary privilege | Non-root with a clear permission message is better. |

## Consequences

### Positive

- No compiler in the pipeline, builds are fast and reproducible.
- Same image runs on amd64 and arm64.
- Safe defaults: loopback publish, read-only root, no capabilities, non-root.

### Negative

- Bind mounts need correct ownership (uid 1000), a common self-hosting stumble. Mitigated by the boot check, docs, and a named volume in the sample compose.
- Loopback-only default means remote access requires an explicit change or a reverse proxy on the same host. This is intentional (see ADR-005) but adds one README step.
- QEMU arm64 builds can be slow.

### Risks

| Risk | Mitigation |
|---|---|
| Prebuild missing or broken for a future `better-sqlite3` version | Exact pin. CI smoke test runs the built image on both architectures. |
| Image fails only on arm64 | CI smoke test on both architectures, native arm64 runner if QEMU hides issues. |
| Docker cannot be tested locally | CI is the first verification. The README documents `docker build` for the owner's homelab host, and the owner may install Docker Desktop. |

## Dependencies

- Depends on ADR-001 (Node 24 LTS, `better-sqlite3`, adapter-node env vars).
- Interacts with ADR-005 (loopback publish default, hardened runtime flags, `ORIGIN` configuration).
