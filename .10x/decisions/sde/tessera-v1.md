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

## M1-03 Deck schema (2026-10-10)

**Built:** `core/schema/{limits,card,deck,errors,json-schema,index}.ts`. Strict Zod schemas for the four card types behind a discriminated union, `validateDeck` returning `Result<Deck, ImportError[]>`, a Zod issue to `ImportError` mapper, the published JSON Schema, `scripts/emit-schema.ts` (run directly by Node 24 type stripping, with `--check` mode), and `static/schema/tessera-deck.v1.schema.json` (committed). 34 new tests, 63 total. `npm run verify` now includes `schema:check`.

**Behavior worth knowing:**

| Topic | Detail |
|---|---|
| Error mapper | Zod 4 reports only the expected type for `invalid_type`, so the mapper reads the raw input to tell `required` (missing) from `wrong_type`. `unrecognized_keys` becomes one error per key, listing the allowed fields for that card type. |
| Error codes | `required`, `wrong_type`, `invalid_value`, `unsupported_version`, `unknown_field`, `invalid_format`, `too_few`, `too_many`, `too_short`, `too_long`, `too_small`, `out_of_range`, `duplicate_choice`, `duplicate_id`, `too_many_errors`. |
| Sorting and cap | Errors sort by document position and are capped at 50, with a final `too_many_errors` entry giving the dropped count. |
| Blank text | Text fields reject whitespace-only strings through a `\S` pattern, which also appears in the JSON Schema. |
| Not expressible in JSON Schema | Choice index range, duplicate choices, and duplicate card ids. `validateDeck` still enforces them. The schema description says so. |

**Deviations from the spec:**

- `hint` is allowed on every card type (spec listed it on basic only). It is a superset, harmless, and avoids rejecting reasonable Claude output.
- `extra` is cloze only and `explanation` is choice only, as in the spec. Misplaced ones produce an `unknown_field` error that lists the allowed fields.
- A missing `tessera` field reports `required` with a clear fix, rather than `unsupported_version`.

**Tech debt:** none.

## M1-04 parseJson and golden fixtures (2026-10-10)

**Built:** `core/parse/json.ts` (`parseJson`), `ImportError.column`, error sorting by schema field order, 4 valid and 10 invalid golden decks plus 7 syntax-error samples under `tests/fixtures/decks/`, and `tests/unit/schema/parse-json.test.ts`. 30 new tests, 93 total.

**Behavior:**

| Input | Result |
|---|---|
| JSON wrapped in a code fence | Accepted. The fence is stripped and syntax error line numbers stay relative to the original text. |
| UTF-8 byte order mark, CRLF | Accepted. |
| Empty or whitespace only | `empty` |
| Over 5 MB | `payload_too_large`, checked before parsing |
| Text that does not start with `{` or `[` | `not_json`, or `not_json_is_markdown` when it starts with `---` |
| Cut off output | `truncated_json` with advice to ask Claude again in smaller decks |
| Other syntax errors | `invalid_json` with line, column, and a hint for the usual cause (trailing comma, single quotes, comments, missing comma, unterminated string) |

**Findings worth keeping:**

- **Truncation shows up two ways.** V8 reports "Unexpected end of JSON input" when output stops inside a value, but reports "Expected double-quoted property name" at the end of the text when it stops right after a comma. The second is the common LLM truncation shape. The parser treats any error positioned at or after the end of the text as truncation. Found because the golden fixture was written the realistic way.
- **Prettier rewrites `﻿` escapes in regex literals into the raw invisible character**, which ESLint then rejects as irregular whitespace. Use `charCodeAt(0) === 0xfeff` instead.
- **Fixture convention:** `invalid/<name>.json` pairs with `<name>.expected.json`, an exact ordered list of `{path, code}`. Tests compare the whole list, so extra or reordered errors fail. Syntax fixtures are `.txt` with `{code, line?, column?}`.
- **Sorting bug fixed.** Errors were ordered alphabetically by object key, which put `cards` errors before `deck` errors. They now follow the schema field order (tessera, deck, cards; type, front, back, ...). A parent path sorts before its children.

**Tech debt:** none.

## M1-05 Database layer (2026-10-10)

**Built:** `server/db/{schema,client,migrate,backup,defaults,tx,index}.ts`, `drizzle.config.ts`, migration `drizzle/0000_init.sql`, `tests/helpers/temp-dir.ts`, `tests/integration/db/database.test.ts` (20 tests). Schema design is recorded in `.10x/decisions/dba/tessera-v1.md`.

**Dependencies added:** `better-sqlite3` 13.0.3, `drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11 (dev), `@types/better-sqlite3` 9.6.0 (dev). `better-sqlite3` 13 ships no types of its own.

**Behavior:**

- `openDatabase({ dataDir, clock, log?, migrationsFolder? })` creates the data directory, opens `tessera.db` with the ADR-001 pragmas, applies pending migrations, seeds missing settings, and returns `{ db, sqlite, path, migration, close }`.
- A database with existing migration history gets a `VACUUM INTO` snapshot in `<dataDir>/backups` before pending migrations run. Fresh databases and no-op reopens write no backup. A failed migration throws an error that names the backup file.
- `withTx(db, fn)` wraps `db.transaction`. Nested calls become savepoints. An async callback is rejected by better-sqlite3 and leaves the connection usable (tested).
- `backupTo(sqlite, dest)` refuses to overwrite an existing file.

**Accepted risk:** `npm audit` reports 4 moderate advisories, all from `drizzle-kit`'s transitive `esbuild <= 0.24.2` (GHSA-67mh-4wv8-2f99: esbuild's dev server accepts cross-site requests). `drizzle-kit` is a dev-only tool that never starts that server. `npm audit --omit=dev` reports 0 vulnerabilities, and that is the gate for CI. Revisit when `drizzle-kit` 1.0 is released.

**Deviations:**

- No separate `card_state(card_pk)` index. The composite primary key `(card_pk, ordinal)` already serves it (the architect's list included one).
- `drizzle.config.ts` is part of the type-checked project.

**Tech debt:** backups are not pruned. Documented in the DBA file, to be mentioned in `docs/backup.md`.

## M1-06 Repositories (2026-10-10)

**Built:** `server/repos/{decks,cards,card-state,review-log,settings,import-history,index}.ts`, `core/settings.ts` (settings schema, defaults, `validateSetting`), the `Executor` type (database or transaction), `tests/integration/repos/repos.test.ts` (20 tests, 40 integration total).

**Decisions:**

- Repositories are plain functions that take an `Executor` first, so the same code runs against the database or inside `withTx`. A test proves repository writes roll back with the transaction.
- Settings keys are camelCase (`targetRetention`, `newPerDay`, `reviewsPerDay`, `rolloverHour`, `leechThreshold`, `interleave`). The architect file used snake_case as illustration. Nothing was persisted yet, so the change was free. Defaults and the Zod schema live in `core/settings.ts` so the settings form can reuse them.
- A corrupt, out-of-range, or unknown stored setting falls back to the default instead of failing, so a bad row cannot stop studying.
- `card_state` bulk operations chunk `IN` lists at 500 to stay under SQLite's bound-variable limit (tested with 1,200 cards).
- Repositories return Drizzle's inferred row types (plain objects). No extra mapping layer, because it would add code without isolating anything.
- The review log has insert and read only. There is no update or delete, matching the append-only rule.
- Queue and stats queries are not here yet. They arrive with M1-11 and M4-04, so they can be shaped by their real callers.

**Tech debt:** none.

## M1-07 Normalization, hashing, planImport (2026-10-10)

**Built:** `core/schema/normalize.ts` (`normalizeCard`, `canonicalJson`, `primaryText`, `reviewOrdinals`), `core/cloze.ts` (minimal `listClozeOrdinals`), `server/import/hash.ts` (`hashCard`, `fallbackKey`, `sha256Hex`), `server/import/plan.ts` (`planImport`), test helpers `makeDeck`, `basic`, `cloze`, `seedDeck`, and 86 new tests (176 total across unit and integration).

**How the plan works:** `planImport(x, deck, { archiveMissing })` reads the deck's existing cards and states and returns `Result<ImportPlan, ImportError[]>` without writing. Each card is `new`, `unchanged`, `updated` (with `changedFields`), `type_changed` (progress reset), or `restored` (an archived card returned). It also plans cloze ordinals to add, restore, or archive, lists cards absent from the file, and lists which to archive when `archiveMissing` is set.

**Deviations and decisions:**

| Item | Detail |
|---|---|
| Fallback key includes the type | `h-` plus 12 hex of SHA-256 over type, newline, and primary text. ADR-002 said primary text only. Without the type, a basic and a typed card with the same question would collide. |
| Position-only change | File reordering does not count as an update. The plan flags `reposition` and the commit applies it silently, so reordering never shows up as noise in the preview. |
| `restored` action | An archived card that returns unchanged is its own action. If it also changed, it is `updated` with `restored: true`. |
| Duplicate keys | Two cards resolving to the same key (identical untitled cards) return a `duplicate_id` error from the plan, because `validateDeck` can only see explicit ids. |
| Early cloze work | `listClozeOrdinals` and ordinal reconciliation landed here instead of M2-01 and M2-02 because the plan needs ordinals for every card type. M2-01 still owns the full scanner, rendering, and nesting. M2-02 still owns burying and queue behavior. |
| Normalization | NFC, line endings to `\n`, leading blank lines dropped, trailing whitespace trimmed per field. Leading indentation of the first content line is kept so indented code survives. Tags and accepted answers are sets (sorted, de-duplicated, empty means absent). Choice order is preserved because `correct` indexes it. |
| Hash scope | Type, content, tags, and source. The id is excluded because it is identity. |

**Tech debt:** none. **Next:** M1-08 commit applies a plan inside one transaction and recomputes the plan inside it.

## M1-08 commitImport (2026-10-10)

**Built:** `server/import/commit.ts` (`commitImport(db, deck, options, clock)`) and `tests/integration/import/commit.test.ts` (17 tests, 84 integration total).

**Behavior:**

- One `withTx` transaction. The plan is recomputed inside it from live data, so a stale preview cannot be applied (tested: a second commit of the same deck after another import landed reports all unchanged and does not violate the unique key).
- New cards get a card row and New review items due now. Updated cards replace content and keep their schedule. Type changes replace the schedule and keep `review_log`. Cloze numbers are added, archived (keeping progress), and restored. Archived cards return with their schedule. `archiveMissing` archives only active cards that belong to the same deck.
- **A re-import that changes nothing writes nothing.** No deck update, no import history row, and SQLite's `total_changes()` is identical before and after (tested, along with a full dump of every table). Reordering cards and repairing item drift are applied silently and do not count as a change.
- `import_history.updatedCount` is updated plus type changed plus restored. `archivedCount` is archived missing cards.

**Rollback evidence:** instead of mocks, tests install SQLite triggers that abort mid-import (on the history insert, on the third card insert, and on an update). In each case the database ends identical to its state before the import, and a later import succeeds. A 2,000-card import completes in well under the 5 second test bound (the formal budget check is M1-22).

**Tech debt:** none.

## M1-13 HTTP layer: hooks, routes, CSP (2026-10-10)

**Built:**

- `server/app.ts` (`createApp`, `initApp`, `getApp`, `closeApp`): config, logger, clock, and database created once in the `init` hook, passed to handlers explicitly.
- `server/http/{hooks,content-type,request-id,headers,route,response}.ts`. Hooks: `requestLogging` (request id, one log line per request, `/healthz` and `/_app/` at debug), `securityHeaders` (`nosniff`, `no-referrer`, `no-store` on `/api/`), `contentTypeGuard` (415 unless JSON, or Markdown on import). `route()` wraps handlers so thrown errors use the standard shape and unexpected errors are logged and hidden.
- `server/api/{import,decks,health,schema}.ts` as plain functions over the app context. Thin `+server.ts` files for `GET /healthz`, `GET /api/schema`, `GET /api/decks`, `POST /api/import`.
- `POST /api/import`: `dry_run` and `archive_missing` flags, `filename`, code fences accepted, 422 with path-level errors, 413 for over 5 MB, 400 for bad flags, 415 for non-JSON (Markdown arrives in M2-08). Dry run returns counts plus every non-unchanged card with changed fields.
- CSP configured as a `sveltekit({ csp })` option in `vite.config.ts`.
- Tests: `tests/unit/http` (23), `tests/integration/api` (hooks, handlers). `scripts/smoke.ts` (`npm run smoke`) starts the real production build and runs 23 checks. CI will run the same script against the Docker image.

**Findings that changed the design (see ADR-006):**

| Finding | Detail |
|---|---|
| adapter-node 6 has no `ORIGIN` variable | Supported: `SOCKET_PATH`, `HOST`, `PORT`, `XFF_DEPTH`, `ADDRESS_HEADER`, `PROTOCOL_HEADER`, `HOST_HEADER`, `PORT_HEADER`, `BODY_SIZE_LIMIT`, timeouts. The protocol defaults to `https`. My `ORIGIN` config setting was dead and is removed. |
| SvelteKit 3 CSRF rule | A mutating request with no content type, or a form type, and an `Origin` that differs from the derived origin gets 403 before any hook runs. Over plain `http` this rejects even same-origin form posts. Requests with `application/json` are exempt. Decision: the UI uses JSON `fetch` only, no form actions (ADR-006). |
| `BODY_SIZE_LIMIT` | adapter-node defaults to 512K. Imports need 5M. The Dockerfile and compose file must set it. The app logs a warning in production when it is unset. The smoke test proves a 5,000 card deck imports at `5M` and a 6 MB body gets 413. |
| Kit 3 hook types | `Handle`, `HandleServerError`, `ServerInit`, and `sequence` come from `@sveltejs/kit/hooks`, not `@sveltejs/kit`. `handleError` receives a `kind` (`app`, `framework`, `unknown`) instead of a status. Only `unknown` is logged. |
| `sequence()` needs a request store | It cannot run with fake events in tests. The hooks live in `server/http/hooks.ts` as plain functions and `hooks.server.ts` only composes them. Tests compose them by hand. |
| CSP result | Kit's `auto` mode emits `script-src 'self'` plus a nonce or hash. No `unsafe-inline` or `unsafe-eval` for scripts. Verified on the real server. |
| Deck metadata on re-import | A revised file that omits `description` or `tags` no longer erases them. Explicit values, including empty ones, update. Found by an API test. `upsertDeck` and the plan now treat omitted fields as unchanged. |

**Tech debt:** request logging does not yet record the API token state or host check (M2-12). `/api/decks` has card counts only. Due and new counts arrive in M1-17.

## M1-20 Container (2026-10-10)

**Built:** `Dockerfile` (two stages on `node:24-trixie-slim`, non-root `node` user, `/data` volume, Node-based healthcheck, `BODY_SIZE_LIMIT=5M`), `.dockerignore`, `compose.yaml` (loopback port, `init`, read-only root, `cap_drop: ALL`, `no-new-privileges`, named volume, proxy header hints), `server/boot-check.ts` (writability check with an actionable message, called before the database opens), shutdown logging, `tests/unit/deploy/container-policy.test.ts` (13 policy tests), `tests/integration/boot/boot-check.test.ts`. ADR-007 added.

**Docker is not installed on this machine, so the image has not been built.** What was verified instead:

- Policy tests lock the ADR-004 and ADR-005 decisions (base image, non-root, copied files, healthcheck without curl, loopback publish, hardening flags, no committed token).
- **Runtime-stage simulation:** a folder holding only `build/`, `drizzle/`, `package.json`, `package-lock.json`, and `.npmrc`, with `npm ci --omit=dev`, starts the server and passes the full 23-check smoke test. Production `node_modules` is 45.6 MB (26 top-level packages), the server bundle is 1.6 MB, and dev tools are absent.
- Not verifiable here: Linux behavior, arm64, `HEALTHCHECK`, signal handling, `read_only` with the real volume, and the image size. CI (M1-21) is where those are proven.

**Finding that overturned an ADR-004 claim (ADR-007):** a clean `npm ci` tries to compile `better-sqlite3` with `node-gyp` because the lockfile does not record `gypfile: false` and the package contains a `binding.gyp`. In the slim image that would fail. Fixed by `ignore-scripts=true` in `.npmrc`. A from-scratch `npm ci` followed by the full `verify` gate now passes.

**Deviations:** none from the plan. Graceful shutdown cannot be exercised on Windows (signals terminate the process). The `sveltekit:shutdown` handler that closes the database and logs is in place, and CI will confirm it with `docker stop` and the container logs.

**Tech debt:** no pruning of `<dataDir>/backups`. `compose.yaml` builds locally and tags `tessera:local`. A GHCR image reference is added in M2-15.

## M1-21 CI workflow (2026-10-10)

**Built:** `.github/workflows/ci.yml`, `.github/dependabot.yml`, `scripts/check-licenses.ts` and `scripts/lib/licenses.ts` (an SPDX license policy evaluator, no external tool), `tests/unit/deploy/{ci-policy,licenses}.test.ts`, npm scripts `licenses` and `audit:prod`.

**Workflow:**

- **Verify job:** `npm ci`, `npm run verify`, `npm run audit:prod`, `npm run licenses`, then `npm run build` and `npm run smoke` against the real Node server.
- **Docker job** (needs Verify; matrix `linux/amd64` and `linux/arm64`, the latter under QEMU): builds the image; asserts it runs as uid 1000 and is under 150 MB compressed (approximated with `docker save | gzip`); starts it with the same hardening as `compose.yaml` (`--init --read-only --tmpfs /tmp --cap-drop ALL --no-new-privileges`, loopback port, named volume); waits for `/healthz`; runs the full smoke script against the container; waits for Docker's own health status; stops it with SIGTERM and asserts exit code 0 and the "shutting down" log line; restarts it and asserts the imported deck survived.
- Every action is pinned to a commit SHA with a version comment, looked up from the GitHub API on 2026-10-10: `actions/checkout` v7.0.1, `actions/setup-node` v7.0.0 (v7.1.0 was only two days old), `docker/setup-qemu-action` v4.4.0, `docker/setup-buildx-action` v4.4.1. Permissions are `contents: read`. Nothing is published and no registry login exists. Publishing is M2-15.
- Dependabot covers npm, Docker, and Actions weekly. It ignores TypeScript majors (Kit 3 needs 6.x) and `ts-fsrs` majors (ADR-003).

**What was verified here:** every step of the Verify job ran locally from a clean install (`npm ci`, `verify`, `audit:prod` with 0 vulnerabilities, `licenses` with 8 production packages all allowed, `build`, `smoke` with 23 passing checks). Policy tests assert the workflow's structure, SHA pins, least privilege, and every container check.

**Not verified here:** the workflow has not run on GitHub (no remote exists), and the Docker job has never executed. Likely first-run surprises to watch for: arm64 under QEMU being slow (45 minute timeout set), the `docker save | gzip` size approximation, and the SIGTERM exit code (adapter-node source shows a natural exit with code 0 after the `sveltekit:shutdown` event).

**Bug found and fixed:** the license evaluator treated `MIT OR` (a missing right operand) as allowed. It now tracks malformed input and requires every token to be consumed.

**Finding:** `npm ci --omit=dev` leaves empty `@scope` directories for omitted dev packages. The production tree is 8 packages, and the extra directories are harmless.

**Tech debt:** the e2e job arrives with M1-22. The CI image size check is an approximation until M2-15 publishes a real manifest.

## M1-09 Scheduler wrapper and conformance (2026-10-10)

**Built:** `core/scheduler/{types,map,engine,labels,read,review,index}.ts`, `scripts/gen-scheduler-fixtures.ts` (`npm run fixtures:scheduler`), `tests/fixtures/scheduler/conformance.json` (12 scenarios, 92 steps from `ts-fsrs@5.4.2`), `tests/unit/scheduler/{conformance,scheduler}.test.ts` (50 tests). `ts-fsrs` 5.4.2 added as an exact production dependency.

**Design:**

- Our own `ItemState`, `Grade`, `CardPhase`, `SchedulerConfig`. `map.ts` is the only place `ts-fsrs` cards and our states convert, copying dates both ways. Only `core/scheduler` imports `ts-fsrs` (lint rule, tested).
- `createScheduler(config)` returns `initialState`, `preview` (all four grades with labels), `review`, and `retrievability`. Short-term learning steps are always on.
- **Read-only split for cram (ADR-003):** `read.ts` exports `createReader`, which can only compute retrievability and never imports review code (tested). Cram mode will import `scheduler/read.ts`, not `scheduler/index.ts`. The lint rule that enforces this is still M4-01.
- Conformance fixtures are generated by running sequences through `ts-fsrs` directly with fuzz off. The test replays each step through the wrapper and compares every field, the retrievability before each review, and that each grade preview equals the real result. A `ts-fsrs` upgrade that changes behavior fails this test, so schedules cannot drift silently.
- Config validation: steps must match `^[1-9]\d*[mhd]$`, retention must be strictly between 0 and 1, both with readable errors.

**Verified behavior of ts-fsrs 5.4.2 (probed):**

| Fact | Implication |
|---|---|
| Retrievability is returned as a number with `format=false`. It is 1 right after a review and 0 for a New card. | The queue only sorts Review items by it. New items are not in that set. |
| Fuzz is deterministic for identical state and time, but shifts if the time shifts even 1 ms. | The interval label on a grade button can differ slightly from the final result when fuzz applies. Labels are advisory. Conformance tests turn fuzz off. |
| `learning_steps` counts completed steps. With steps 5m, 30m, 1d a first Good lands on the 30m step. | The wrapper maps it as is. |
| `repeat()` does not mutate its input. | Safe to preview then review the same state. |
| A Review card answered Again becomes Relearning with `lapses + 1` and the relearning step as its due time. | Matches the leech logic planned for M3. |

**Deviations:** `review()` returns the next `ItemState` directly instead of the `{ next, snapshot }` pair in ADR-003. The log needs only the next state and `scheduledDays`, both already on `ItemState`.

**Tech debt:** none.

## M1-10 Study-day helper (2026-10-10)

**Built:** `core/study-day.ts` (`studyDayStart`, `nextRollover`, `studyDayKey`) and `tests/unit/time/study-day.test.ts` (31 tests). It lives in `core` rather than `server/clock.ts` as the plan said, because it is pure (takes `now`, never reads the clock) and the UI will want the same day boundaries.

**Rules:**

- The study day starts at the most recent rollover hour in the configured time zone at or before `now`. Day length is 23 or 25 hours across DST changes.
- A rollover hour that does not exist (spring-forward gap) resolves to the first valid instant after the gap. One that happens twice (fall back) resolves to the first occurrence, and the repeated hour stays inside the same study day.
- Uses only `Intl.DateTimeFormat`, so the platform tz database decides offsets. Formatters are cached per zone. An unknown zone or invalid hour throws `RangeError`.

**Verification:** hand-derived expectations for America/Chicago summer, winter, both DST days, gap and repeated rollover hours, UTC, Asia/Kolkata (half-hour offset), midnight and 23:00 rollovers. An invariant sweep over 2026 and 2027 checks, for Chicago, London, Sydney, and Kolkata at rollover hours 0, 1, 2, and 4, that the day contains the instant, is 22.9 to 25.1 hours long, and chains to the next day exactly. The sweep samples coarsely across the range and densely around each detected DST transition. A meta-test confirms it finds 4 transitions in each DST zone and none in Kolkata. The first version of the sweep took 10 seconds. Sampling around transitions instead cut it to 3 seconds with better coverage.

**Tech debt:** none.

## M1-11 Study queue (2026-10-10)

**Built:** `server/repos/study-queries.ts` (all queue SQL), `server/study/{queue,state,index}.ts` (`selectNext`, `countQueue`, row and `ItemState` mapping), `Rng` and `systemRng` in `server/clock.ts`, `tests/integration/study/queue.test.ts` (61 tests).

**Selection order (refines ADR-003):**

1. Learning and relearning items due now, earliest first.
2. Review items due before the study day ends, lowest recall probability first (random with interleave on), unless the daily review limit is reached.
3. New items, deck title then file order, per deck up to its daily limit (random among a window of 50 with interleave on).
4. **Learn-ahead:** learning items due within the next 20 minutes, only if nothing above is left.
5. Otherwise empty, with `waitingUntil` set to the next learning item due later today, if any.

**Deviation from ADR-003:** the ADR placed learn-ahead items first. That would show a card due in 19 minutes before reviews that are due now, shrinking the spacing the algorithm just computed. Learn-ahead is now a last resort, which matches standard flashcard behavior. ADR-003 carries a status note.

**Rules worth knowing:**

| Rule | Detail |
|---|---|
| Daily new limit | Per deck: the deck's `new_per_day` override, otherwise the global setting. Counted from `review_log` rows with `mode = review` and `pre_phase = 0` since the study day started, so a card counts once on its first review. Cram rows and yesterday's rows do not count. |
| Daily review limit | Global across decks. Counts only reviews of graduated cards (`pre_phase = 2`). Learning and relearning repeats never count and are never blocked by the limit. |
| Due today | Reviews due any time before the next rollover are available now, not only those already overdue. |
| Exclusions | Archived or suspended cards, archived review items, archived decks, and items buried past `now`. |
| Recall ranking | Uses `createReader()` from `core/scheduler/read.ts` (read-only). Up to 5,000 due reviews are ranked in memory per request. |
| Randomness | Injected `rng`. Production uses `systemRng` from `clock.ts`. |

**`countQueue`** mirrors the filters and limits so the home screen's numbers always match a session. Learning counts items due now (not learn-ahead), reviews are capped by the remaining allowance, and new items are capped per deck by the remaining deck allowance.

**Verification:** targeted tests for every rule above, plus a drain test: it answers every served item (logging it and moving it into the future) until the queue is empty and asserts the number served equals `learning + review + new` from `countQueue`. That runs on a hand-built scenario and on 25 seeded random scenarios with random limits, per-deck overrides, interleave, exclusions, and prior activity. A guard test confirms at least 20 of those scenarios serve items and the largest serves 10 or more, so the agreement is not vacuous.

**Tech debt:** none. `nextItem` for the API (attaching previews and card content) is M1-12 and M1-18.
