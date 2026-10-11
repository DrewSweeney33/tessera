# SDE Decisions: tessera-v1

**Phase:** 4 Implementation (running log, newest task last)
**Plan:** `.10x/decisions/engineering-manager/tessera-v1.md`

Each entry records what was built, deviations from the plan or ADRs, and tech debt created.

## M1-01 Scaffold (2026-10-10)

**Built:** SvelteKit 3.0.1 app created with the official `sv` 1.1.1 CLI (TypeScript, Prettier, ESLint, Vitest, Playwright, adapter-node). Exact dependency pins, strict TypeScript flags, layer lint rules with a test proving they fire, `ssr = false`, test folder layout, `scripts/pin-exact.mjs`, README stub. `npm run verify` is green. Production build starts and answers HTTP 200.

**Deviations and findings:**

| Item | Detail |
|---|---|
| Kit 3 config location | There is no `svelte.config.js`. The adapter and compiler options are passed to `sveltekit({...})` in `vite.config.ts`. CSP configuration in M1-13 must be located in that options object or its Kit 3 equivalent. Verify the exact option name then. |
| Import alias | The scaffold uses `#lib/*` (package.json `imports`) instead of `$lib`. Code uses `#lib`. The lint rules cover both. Check at M1-13 that Kit still treats `src/lib/server` as server-only through the `#lib` alias. |
| Vitest version | The scaffold chose Vitest 4.1.11, although 5.0.3 exists. Kept the scaffold's tested pairing with Vite 8. |
| npm 11.2.0 resolver crash | `npm install` failed with `Cannot read properties of null (reading 'edgesOut')`. Root cause: `yaml@1.10.3` hoisted to the top level while Vite wants an optional peer `yaml ^2.4.2`. Adding `yaml@2.9.1` as a direct dependency (needed anyway, ADR-002) fixed it, and a clean `npm ci` works with no `legacy-peer-deps` setting. |
| `npm cache verify` | Run while diagnosing, it garbage-collected about 513 MB of unreferenced npm cache content. Harmless but broader than intended. Avoid in future diagnosis. |
| BOM in package.json | Windows PowerShell 5.1 `Set-Content -Encoding utf8` writes a byte-order mark that breaks `JSON.parse`. Write JSON with the Write tool or Node, never PowerShell `Set-Content`. |
| ESLint pattern gotcha | `no-restricted-imports` `patterns` use gitignore syntax, so `#lib/...` must be written `\#lib/...`. The first version silently did nothing. Caught by `tests/unit/lint-layers.test.ts`. |
| Tests layout | Tests live under `tests/{unit,integration,e2e,fixtures}` per the staff-engineer layout. Vitest has `unit` and `integration` projects. |
| LICENSE file | Not yet added. The AGPL-3.0 text is not on this machine and downloading it needs the owner's permission. Pending. |
| Cram lint rule | The rule forbidding cram modules from importing `scheduler.review` is deferred to M4-01, when the scheduler's module split (read-only versus review) exists. |

**Tech debt:** none yet.

## M1-02 Foundations (2026-10-10)

**Built:** `core/result.ts` (Result, ok, err), `server/clock.ts` (Clock, systemClock), `server/log.ts` (JSON line logger with level filter, child loggers, key-based redaction of card content, typed answers, and credentials), `server/config.ts` (Zod env parse, blank means unset, frozen, `parseConfig` pure and `getConfig` memoized), `server/http/errors.ts` (one error shape, status map, `AppError`, `toErrorResponse` that hides internals), `tests/helpers/fake-clock.ts`. 21 new tests, 29 total.

**Conventions set (apply to all later tasks):**

| Convention | Detail |
|---|---|
| Import specifiers | Always include the file extension: `#lib/core/result.ts`, `./clock.ts`. In Kit 3, extensionless `#lib/...` imports fail type checking (verified). `.ts` works and also lets Node 24 run scripts against app code natively. |
| `erasableSyntaxOnly` | On in tsconfig. No enums, namespaces, or constructor parameter properties anywhere. This keeps `core` runnable by Node's built-in type stripping for scripts such as the schema emitter. |
| Test helpers | Shared helpers live in `tests/helpers/`. `fakeClock()` is the standard clock for tests. |

**Deviations:** none. **Tech debt:** none.
