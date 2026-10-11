# ADR-007: Install Without Lifecycle Scripts

**Status:** Accepted
**Date:** 2026-10-10
**Feature:** tessera-v1
**Author:** 10x-Team (Architect + SDE)
**Refines:** the "prebuilt binaries, no compiler" reasoning in ADR-004

## Context

ADR-004 concluded that `better-sqlite3` 13 needs no compiler because it ships prebuilt binaries inside its npm package. That is true at runtime, but the install step was verified only with `npm install better-sqlite3@13.0.3`. The first from-scratch `npm ci --omit=dev`, simulating the Docker runtime stage, failed with `node-gyp rebuild` and `find VS` errors.

Cause, verified in the package and the lockfile on 2026-10-10:

- `better-sqlite3` 13.0.3 declares `"gypfile": false` and has no `install` script. Its loader picks a per-platform prebuild file (`linux-x64.js`, `linux-arm64.js`, `win32-x64.js`, and so on).
- The package still contains a `binding.gyp`.
- `npm install <pkg>` reads the registry manifest, sees `gypfile: false`, and skips compilation.
- `npm ci` rebuilds from the lockfile, which does not record `gypfile`. npm then falls back to its default of running `node-gyp rebuild` for any package with a `binding.gyp`.

In the `node:24-trixie-slim` image there is no Python, make, or C++ compiler, so `RUN npm ci` in the Dockerfile would have failed. The same happens on any developer or CI machine without a C++ toolchain.

## Decision

Set `ignore-scripts=true` in the committed `.npmrc`. This applies to local installs, CI, and the Docker build, because `.npmrc` is copied into the image build stage.

Verified with this setting:

- A clean `npm ci` succeeds on a machine without Visual Studio build tools.
- The full `npm run verify` gate passes afterward (type check, lint, schema check, 134 unit and 122 integration tests).
- A production-only `npm ci --omit=dev` in an empty folder, with just `build/`, `drizzle/`, and the package files, starts the server and passes the full 23-check smoke test.

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| `npm ci --ignore-scripts` only in the Dockerfile | Narrower change | Contributors and CI runners without a toolchain still fail on `npm ci`. Easy to forget the flag. | The problem affects everyone who runs `npm ci`. |
| Install `python3 make g++` in the build stage | Works even if a prebuild is missing | Slower, larger build stage, and compiles from source needlessly, hiding a missing-prebuild problem | Prebuilds exist for every target platform. |
| Switch to `node:sqlite` | No native dependency | Release-candidate status and a reported NUL truncation bug on Node 24.15.0 (ADR-001) | Revisit when stable. |
| Pin an older `better-sqlite3` with an `install` script that downloads prebuilds | Familiar mechanism | Downloads from GitHub at install time, more moving parts | v13 bundles the binaries, which is better. |
| Leave as is and document needing build tools | No change | Violates the "one command to run it" goal | Rejected. |

## Consequences

### Positive

- Installs are fast and need no toolchain, locally, in CI, and in the image.
- Install-time code execution from every dependency is blocked, a supply-chain hardening (ADR-005 section 8).

### Negative

- The `prepare` script (`svelte-kit sync`) no longer runs on install. `npm run check` and `npm run build` run it themselves, and `npm ci` followed by `npm run verify` is proven to work.
- A future dependency that genuinely needs an install script (for example, one that downloads a binary) will not set itself up. It would fail visibly, and the fix would be an explicit step.
- Playwright browsers are installed explicitly by a CI step and a documented command, never by an install script.

### Risks

| Risk | Mitigation |
|---|---|
| A dependency update drops its bundled binaries | CI builds the real image on amd64 and arm64 and smoke tests it, so a missing binary fails the build, not production. |
| A transitive package needs a script and silently misbehaves | The clean-install-plus-verify check runs in CI on every change. |
| The behavior differs on Linux arm64 | The multi-arch CI smoke test covers it. |

## Dependencies

- Refines ADR-004 (container build). Constrains M1-21 (CI installs with `npm ci` and installs Playwright browsers explicitly).
