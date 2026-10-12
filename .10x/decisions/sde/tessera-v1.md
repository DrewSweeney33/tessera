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

## M1-12 submitReview (2026-10-10)

**Built:** `server/study/{schema,submit}.ts` (`submitReview`, `ReviewInputSchema`, `serializeState`) and `tests/integration/study/submit.test.ts` (33 tests).

**Behavior (ADR-003), all inside one transaction:**

1. A repeated `reviewId` returns the stored result with `replayed: true` and changes nothing. This is checked before the stale check, because after the first submit the item's `lastReview` is newer than `servedAt` and a replay would otherwise look stale (tested). An id reused for a different card or item is refused (`review_id_reused`).
2. An unknown card or review item returns `not_found`.
3. If `lastReview > servedAt` the submission is `stale_review` (another tab answered first). A submission served at exactly the last review time is accepted.
4. The scheduler runs with the deck's `target_retention` override, else the global setting. Schedulers are cached per retention value.
5. The state row is updated and a `review_log` row is written with the full pre-review columns, the post-review state as JSON `result`, `scheduled_days`, `duration_ms`, and `typed_answer`.
6. **Cloze siblings** are buried (`buried_until`) until the next study day rollover. Archived siblings and single-item cards are untouched.
7. **Leech flag:** `leech` is set when `lapses >= leechThreshold` and the item is not already flagged, and `becameLeech` is true only on that review. It is not suspended. This landed here instead of M3-01 because it belongs in the same transaction. M3-01 keeps the list queries and UI.

**Input schema:** strict Zod: `reviewId` 8 to 64 characters of letters, digits, and hyphens, `cardPk`, `ordinal` 0 to 99, `grade` 1 to 4, `servedAt` an ISO UTC timestamp, optional `durationMs` (0 to 1 hour) and `typedAnswer` (up to 2,000 characters). Unknown fields are rejected.

**Verification:** trigger-based rollback proof (a failing log insert leaves the schedule and sibling burying unchanged, and the next submit works), per-deck retention changes the interval, the queue and `countQueue` react correctly (a new card uses up the allowance, leaves the queue until due, and returns as learning). 13 schema cases are covered.

**Test correction:** the first version expected the second Good to still be in learning. With the default steps (1m, 10m) it graduates, which matches the conformance fixtures. The test was wrong, the code was right.

**Tech debt:** the result carries only the new state. Previews for the next card and its content are attached by the API layer (M1-18).

## M1-18 Study API routes (2026-10-10)

**Built:** `server/study/dto.ts` (`buildNext`, `StudyItemDto`), `server/api/study.ts` (`handleStudyNext`, `handleStudyReview`), `server/http/validation.ts` (`fieldErrors`), `rng` on the app context, routes `GET /api/study/next` and `POST /api/study/review`, `tests/integration/api/study.test.ts` (15 tests). The smoke script grew from 23 to 28 checks.

**Contract:**

- `GET /api/study/next?deckId=` returns `{ done: false, item, counts }` or `{ done: true, waitingUntil, counts }`. The item carries `category`, `cardPk`, `ordinal`, `deckId`, `deckTitle`, `key`, `type`, authored `content` (Markdown text for the browser to render and sanitize), `tags`, the serialized `state`, `previews` (a label for each of grades 1 to 4), and `servedAt`.
- `POST /api/study/review` takes a review (`reviewId`, `cardPk`, `ordinal`, `grade`, `servedAt`, optional `durationMs`, `typedAnswer`) plus an optional `deckId` for scoping the next card. It returns `{ result, next }`, so a session normally needs one request per card (ADR-003).
- Errors use the standard shape. Stale is 409 `stale_review`. A missing card or deck is 404. A reused `reviewId` is 400. Validation problems are 422 with `{ path, code, message }` for each field, including `unknown_field`. A bad deck id format, invalid JSON, and an oversized body (over 16 KB) are 400, 400, and 413.
- Neither route logs card content or typed answers (tested).

**Counts are review items, not cards.** The CCNA fixture has 8 cards but 11 new items, because each cloze blank is its own review item. The smoke test initially asserted 8 and failed on the real server. The home screen (M1-17) must label these as items or "to study", not "cards".

**Verification:** a whole session through the two endpoints works through every new card, then each learning card again via learn-ahead, graduates them, and ends done. A cloze card's sibling stays buried after its first blank is answered, and the response sequence matches the expected order. The real-server smoke covers next, answer, idempotent replay, unknown deck, and invalid review.

**Tech debt:** none.

## M1-14 Visual direction, tokens, app shell (2026-10-10)

**Built:** `src/lib/ui/{tokens,fonts,base}.css`, `theme.ts`, `Logo.svelte`, `ThemeToggle.svelte`, `src/routes/+layout.svelte`, `static/fonts/*` with the three OFL texts, `static/theme-init.js`, `docs/design.md`.

**Direction (chosen by me, as the owner delegated it):** "Tessera Desk". Warm oat paper and charcoal in OKLCH with `light-dark()`, one verdigris accent, Newsreader for card text, Geist for the interface, JetBrains Mono for code and key hints, a two by two tile mark. Rationale and rules are in `docs/design.md`. The Hallmark app-scope rules were applied: tokens only, upright headings, two families plus one outlier, visible focus rings, all button states, `overflow-x: clip`, non-wrapping clickable text.

**Fonts are static files, not npm packages.** The CSP is `self` only, so the woff2 files are copied into `static/fonts/` with their OFL texts. Latin subset only. A deck in another script falls back to system fonts.

**Finding fixed in M1-22:** the saved theme was applied only after the app loaded (`ssr = false`), so a dark choice on a light system flashed light. `static/theme-init.js` (same-origin, allowed by the CSP) now applies it before first paint. A browser test aborts the whole app bundle and still sees the saved theme.

**Verification:** contrast audited in the browser, 36 of 36 text and control pairs pass AA in both themes. Layout checked at 320, 375, 414, and 768 px by a browser test.

## M1-15 Markdown component and XSS corpus (2026-10-10)

**Built:** `ui/markdown.ts` (`renderMarkdown`, `renderInlineMarkdown`, exported `sanitizeHtml`), `ui/Markdown.svelte` (the only `{@html}` in the app), `tests/e2e/xss-corpus.ts` (20 payloads), `tests/e2e/xss.spec.ts`, `tests/unit/ui/markdown-security.test.ts` (50 tests under jsdom).

**Two layers (ADR-005):** marked is configured so raw HTML is shown as text, images become their alt text, and links must match an allow-list (`https`, `http`, `mailto`, anchors, relative paths, never `//host`). DOMPurify then sanitizes the result with a forbidden tag list, `style`, `srcdoc`, `action`, `id`, and `name` attributes removed, no data attributes, and `rel="noopener noreferrer" target="_blank"` forced on every link. If rendering throws, the component falls back to the raw text and the card stays gradable.

**Negative control found a real gap in the tests.** I disabled DOMPurify and rebuilt. The browser corpus still passed, because layer 1 already neutralizes everything in it. Only the link attribute test failed. So the corpus alone could not detect a layer 2 regression. Fix: `sanitizeHtml` is exported and tested directly with 22 raw hostile HTML strings that never pass through marked. With DOMPurify disabled again, 23 unit tests now fail. Both layers are covered separately and together.

**Also added:** `id` and `name` to the forbidden attributes, to rule out DOM clobbering.

## M1-16 Import UI (2026-10-10)

**Built:** `routes/import/+page.svelte`, `ui/{api,clipboard}.ts`, `core/fix-request.ts`, `core/api-types.ts` (shared DTOs, the server now imports them from here).

**Behavior:** paste, file picker, or drop. Preview shows the plan (counts, warnings, changed cards, first 50). Changing the text after a preview marks it stale and disables Import until the next preview. Errors list a line and column for syntax problems, or the field path. "Copy errors for Claude" builds the message from `buildFixRequest` and, if both the Clipboard API and `execCommand` fail (plain HTTP on a LAN address is not a secure context), shows the text in a read-only box for manual copy.

**Finding fixed in M1-22:** V8 gives a position for most JSON syntax errors but not for "Unexpected token 'X', ..." (a trailing comma in an array, a stray comma). Those errors had no line or column and printed a raw source snippet. `parseJson` now locates them by binary search for the shortest prefix that fails with "Unexpected token" (shorter prefixes fail at end of input), reports `Unexpected character "," at line 4, column 14`, and adds a trailing comma hint. Tested for arrays, a leading dot, a stray comma on a later line, a 10,000 element text, and CRLF with a code fence.

## M1-17 Home deck list (2026-10-10)

**Built:** `routes/+page.svelte`. `/api/decks` now returns per-deck `counts` and `totals` from `countQueue`, so the numbers match what a session will show. Labels say items to study, not cards. Empty, loading, and error states, and "Study all decks".

## M1-19 Study UI (2026-10-10)

**Built:** `routes/study/[[deckId]]/+page.svelte`, `ui/card-sides.ts`, `ui/id.ts`.

**Behavior:** Space or Enter reveals, 1 to 4 grade, Space grades Good after the reveal, H shows the hint. Focus moves to the card for each new item and to the Good button after the reveal. A failed grade submission is retried with the same `reviewId` (idempotent). A 409 reloads the queue. The done screen shows the session tally and when the next item is due. All four card types render, graded by the learner for now (typed matching is M2-03 and M2-10).

**Plain HTTP:** `crypto.randomUUID` and `navigator.clipboard` are missing on a non-secure LAN address, so `newId` falls back to `getRandomValues` and `copyText` to `execCommand`.

**Learn-ahead is visible and intended:** after Good on a new card the card returns as "Learning" when nothing else is due (ADR-003 refined). A browser test pins this, and a keyboard-only flow uses Easy to finish a session.

## M1-22 End-to-end tests and benchmark (2026-10-10)

**Built:** `playwright.config.ts`, `scripts/e2e-server.ts`, `tests/e2e/{helpers,xss-corpus,xss.spec,import-and-study.spec,layout-and-theme.spec}.ts` (20 tests), `scripts/benchmark.ts`, `docs/performance.md`, CI steps for the browser install, e2e, and benchmark.

**Playwright uses the installed Chrome locally** (`channel: 'chrome'`), so no browser download was needed. CI sets no channel and runs `npx playwright install --with-deps chromium`. This path has not run on GitHub yet.

**Coverage:** XSS (20 payloads in 2 groups, link safety, broken formatting), a keyboard-only import and study flow, stale preview, re-import reports no change, errors and the Claude message (real clipboard and the blocked fallback), invalid JSON location, no sideways scroll and no wrapped controls at four widths across home, import, and study, theme persistence, no flash with the bundle blocked, auto following the system, blocked storage.

**The wrapped-control detector was checked with a negative control** (a squeezed button is flagged, the real page is clean).

**Benchmark (5,000 cards, 1.4 MB):** import 1.05 s against a 10 s budget, unchanged re-import 138 ms, study next 14 ms median, review 11 ms median. The script exits 1 over budget.

**Tooling fix:** `scripts/e2e-server.ts` imported `../build/index.js` statically, so `svelte-check` followed it into the compiled output and reported 933 errors once a build existed. The path is now a variable.

## M1-23 README, example deck (2026-10-10)

**Built:** `README.md` (what works, Docker quickstart, security note, writing decks with Claude, configuration, development), `examples/ccna-ospf.json`, `tests/unit/schema/examples.test.ts` (every example must parse), `docs/design.md`, `docs/performance.md`.

**The README says what is not done.** `TESSERA_API_TOKEN` and `TESSERA_ALLOWED_HOSTS` are listed as reserved and inactive (enforcement is M2-12).

## Open issues found during the UI work

1. **API token versus the browser UI (design tension for M2-12).** ADR-005 says every `/api/*` route except `/healthz` and `/api/schema` requires the bearer token. The browser UI calls those same routes and has no token, so enabling the token as written would lock the UI out. M2-12 must decide how same-origin UI requests are authenticated or exempted (for example a separate prefix for the UI, or the reverse proxy doing the authentication and the token covering only external clients). Needs an owner decision or an ADR amendment before M2-12.
2. **CI has never run.** There is no GitHub remote. The e2e step in CI (Chromium install) and the Docker jobs are unverified.
3. **No LICENSE file** yet (owner permission to download the AGPL-3.0 text).
4. **Latin-only fonts.** Cards in other scripts use system fallbacks.

## Phase 5 verification fixes (2026-10-11)

Done by the QA and security pass, recorded here so the log stays complete. Reports: `.10x/reviews/2026-10-11-qa-report.md` and `2026-10-11-security-review.md`.

**Q-02 / S-03, oversized chunked body returned 500.** Built `server/http/body.ts` (`readBodyText`) and used it in the import and review routes. It enforces the byte cap itself instead of trusting the declared length or the adapter, stops reading at the limit, maps the adapter's `BODY_SIZE_LIMIT` error to 413, maps an interrupted connection to 400, and counts bytes (the review route compared string length). 10 unit tests including an endless stream that must not be consumed.

**Q-01, no h1 on the study screen.** A visually hidden `h1` ("Studying: deck") renders in every state except done, which already has a visible one. Found by axe, not by the earlier keyboard or layout tests.

**New tooling:** `scripts/security-probe.ts` (102 checks), `scripts/durability-check.ts` (54 checks, reads the SQLite file directly for integrity and card counts), `tests/e2e/robustness.spec.ts` (17), `tests/e2e/accessibility.spec.ts` (13), dev dependencies `@axe-core/playwright` 4.13.0 and `@vitest/coverage-v8` 4.1.11 (exact, matching Vitest). CI runs the probe and the durability check after the build.

**Corrections to my own checks while building them:**

- The probe first expected 415 for wrong content types. SvelteKit's built-in CSRF check answers 403 first for cross-origin form-typed requests. Both layers are now tested separately (evil origin for the first, a same-origin request for ours).
- The durability check first measured the study queue, which is capped by the daily new-card limit, and reported 20 cards for a 300 card deck. It now reads the `cards` table directly.
- All six initial kill times landed before the commit, so only the rollback branch was seen. Later kill times were added and both outcomes (absent and complete) now occur.
- `SIGTERM` on Windows terminates the process without running shutdown code, so that one check is skipped there and covered by the Linux container job.

**Mutation check:** 15 deliberate bugs, 14 caught. The CSP `script-src` loosening survived because only the built server shows the CSP. The probe now runs in CI.

**Not changed on purpose:** S-01 (host check) and S-02 (token design) are scheduled as M2-00 and before M2-12. S-02 needs an owner decision.

## Phase 6 delivery fixes (2026-10-11)

Recorded here so the log stays complete. Decisions: ADR-008. Role files: `.10x/decisions/devops/tessera-v1.md`, `.10x/decisions/sre/tessera-v1.md`.

Each of these was found by running a failure against the built server, not by reading code.

**Two copies on one data folder (writes failed).** Two servers on one folder, 60 concurrent imports: 47 failed with "database is locked" and `busy_timeout` did nothing. A deferred transaction that reads first and writes later fails immediately when another process committed in between. `withTx` and the settings seed now begin immediately (`behavior: 'immediate'`), so the write lock is taken up front and `busy_timeout` applies. Result: 60 of 60. A unit-level test proves the lock is held at the start of the transaction; a process-level check proves the outcome. Both are killed by reverting the change.

**Older version opened a newer database.** `runMigrations` only counted migrations it was missing. It now compares the newest applied timestamp with the newest it knows and throws `DatabaseTooNewError` before touching anything. A test inserts a future migration and checks the refusal, the message, and that the file is byte for byte unchanged. (The first version of the byte check failed because a file not yet in WAL mode gets one header byte changed on open. The test database is now put in WAL mode first, as a real one would be.)

**Damaged database.** "file is not a database" now becomes `DatabaseOpenError`: names the file, says it was not changed, says to restore a backup and where backups are. Also covers locked, unwritable, and full. `openSqlite` now closes its handle if the first pragma throws. Truncated-to-half and random-bytes files both tested, bytes unchanged.

**Clock stepping backwards.** A card graded, then the clock set back 3 minutes: the card was offered again (learn-ahead) with `servedAt` earlier than its `lastReview`, so grading was rejected as stale. Reproduced with a failing test first. `buildNext` now stamps an item no earlier than its own last review. Genuine two-tab races are still caught (second test).

**Release workflow shell steps.** Extracted from the YAML and executed on nine cases. Found: `grep` treated the version's dots as wildcards (0.1.0 matched a section for 0x1x0), and a changelog section holding only blank lines passed the empty check. Both fixed, using plain string matching in awk and a real-content check. Backslash escapes were removed on purpose: Windows Git-bash mangles them, so the steps now behave the same everywhere.

**Operations guide checks.** `scripts/ops-check.ts` extracts the backup command from `docs/operations.md` and runs it as written during live writes, restores the result, and checks every message in the troubleshooting table. One check showed the copy-the-live-file warning is understated: the copy of a fresh database had no tables at all. 26 checks, in CI.

**Numbers.** 5,000 cards plus 200,000 review records: 9 to 14 ms per call, 1 s start, 0.4 s online backup. A 3 minute soak at about 140 requests a second: no 5xx, memory flat at 313 MB (earlier docs said 250, corrected).

**Process mistakes worth remembering.** A health fetch with no timeout hung a drill script for three minutes. Review ids shorter than 8 characters are rejected, which made a script report "graded 0". PowerShell here-strings strip backticks from Markdown.

## M2-00 Host check against DNS rebinding (2026-10-11)

Closes security finding S-01. Milestone 2 started on the owner's instruction the same day.

**Built:** `server/http/hosts.ts` (`isHostAllowed`, `displayableHost`), the `hostGuard` hook in `server/http/hooks.ts`, its place in the pipeline in `src/hooks.server.ts`, a startup log line in `server/app.ts`, tests, probe checks, and docs.

**Rules.** A request is answered when its Host is `localhost` or `*.localhost`, any IP address (IPv4 or an IPv6 literal), a single-word name, or a name ending in `.local`, `.lan`, `.home.arpa`, `.internal`, or `.localdomain`. When `TESSERA_ALLOWED_HOSTS` is set, only the listed names are answered (entries: `name`, `name:port`, `*.domain`), and IP addresses and localhost still work, because a rebinding page always arrives under its own domain, never an address. `/healthz` is exempt. Anything else gets HTTP 421 `misdirected_request`, still carrying the security headers and a request id, and a message that names the host and says to set `TESSERA_ALLOWED_HOSTS`. The Host is parsed strictly: userinfo tricks, paths, spaces, empty labels, bad ports, over-long names, and numeric parts over 255 are all refused. The refusal is logged with the host name only.

**The owner's own setup needs the setting.** A real domain name behind a reverse proxy (the planned `tessera.sweentech.com` behind Nginx Proxy Manager) is refused by default, on purpose, since that is the name an attacker would also use. The deployment guide, the compose file, the changelog, the troubleshooting table, and the handoff all say so.

**Verification.** 64 matcher cases (including `127.0.0.1.nip.io`, `7f000001.c0a80001.rbndr.us`, `localhost.evil.com`, `tessera.lan.evil.com`), 9 hook tests, a test that reads the real `src/hooks.server.ts` and checks the pipeline order, and 40 new probe checks against the real build, including a second server started with the setting. The probe's `KNOWN` entry is gone: 140 checks, none open.

**Mutation check.** 13 injected bugs, 12 caught. The survivor changed nothing: `host.name.length > domain.length` in the wildcard matcher was dead code, because the domain already starts with a dot. Removed instead of tested.

**Why the pipeline test exists.** `src/hooks.server.ts` cannot be imported in a test, so deleting the guard would have passed every other unit test and shown up only in the probe, the same hole the CSP mutation exposed in Phase 5.

## M2-01 to M2-04 Card type logic (2026-10-11)

Core logic for cloze, typed, and choice cards. The study screen does not use the typed matcher or the choice shuffle yet; that is M2-10.

**M2-01 Cloze core.** `core/cloze.ts` is now a scanner, not a regular expression. It reads the text once with its own stack (so thousands of unclosed markers cannot overflow the call stack), builds a tree of text and blanks, and renders a card for one number: that number's blanks are hidden (as the hint or an ellipsis), other numbers are shown as their answers, and in the answer the asked number is bold. Nested blanks work (asking the inner number shows the outer text with only the inner part hidden). A blank with the same number as one inside it hides all of it. Single braces, double braces that are not markers, a stray `}}`, and `::` outside a blank are ordinary text. The first `::` inside a blank starts its hint. `{{{c1::x}}}` keeps its outer braces.

`validateCloze` reports `unclosed_cloze`, `invalid_cloze_number` (0, over 99, a letter, no number, a leading zero), `empty_cloze`, and `cloze_too_deep` (more than 8 levels), each with a message that names the marker and gives line and column. At most 20 are reported. The cloze card schema now refuses these through a `superRefine`, with the issue code as the import error code, so a deck with a mistake goes back to Claude with the position. The published JSON Schema file did not change.

One visible effect: a card whose only marker is `{{c0::x}}` used to get just "needs at least one cloze marker". It now also gets `invalid_cloze_number`, which says why. The golden fixture was updated to expect both.

**M2-02 Cloze in import and queue.** Almost all of it existed from M1 (an item per number, add, archive and restore on edits, burying in `submitReview`, the queue skipping buried items). The new tests cover what the scanner changed: nested numbers get items, progress survives nesting an existing blank inside a new one, an unclosed blank is refused over the API with line and column and nothing written, and a nested card is served as two sibling items, one buried until the next study day.

**M2-03 Typed matcher.** `core/typed-match.ts`. Normalization is deliberately light: NFKC, case fold (with the German sharp s as `ss` and every Greek sigma alike), whitespace runs collapsed, and sentence punctuation dropped only at the end. Nothing inside the text changes, so `10.0.0.1` and `10001` stay different, as do `a-b` and `ab`, words in another order, and a different accent. Nothing typed never matches, even for an answer that is only punctuation. The accepted list gets the same leniency as the main answer, and the result says which one matched. The suggested grade is Good or Again. The learner can override it in the UI.

**M2-04 Choice.** `core/choice.ts`. The schema already rejected a correct index out of range, duplicates, and bad counts; new tests add negative, fractional, text, missing, case and spacing duplicates, empty and over-long choices. New: `gradeChoice` (grades by the author's index, so it does not matter where an option is shown, and a position that does not exist is simply wrong), and `shuffleChoices` with a seed (FNV-1a hash into a mulberry32 generator, so the same seed gives the same order on every machine). `choiceSeed` includes the item's review count, so a refresh mid-question keeps the order and the next review reshuffles. A distribution test checks the shuffle does not favour a position. The pinned order in the test was recorded from the implementation, so it guards against accidental change (which would reshuffle everyone's cards after an upgrade) but does not prove correctness. The distribution and permutation tests do.

**Error wording fixed on the way:** a fractional `correct` said "must be of type int, but found a number". It now says "correct must be a whole number, but found 1.5".

**Mutation check.** 17 deliberate bugs in the new code, 17 caught.

**Tests added:** cloze 70 or so (parsing, rendering, nesting, issues, pathological input, random garbage, deck level), typed 47, choice 32, plus 5 integration. The unit suite is 532.

## M2-05 to M2-08 Markdown deck format (2026-10-11)

The Markdown format of spec section 6.2, read into the same plain object a JSON deck gives and handed to the one validator, so the two formats cannot disagree about what is valid.

**Parser (`core/parse/markdown.ts`, `markdown-syntax.ts`).** Front matter is YAML (`yaml` 2.9.1, core schema, unique keys, alias limit 10, so unknown tags and alias bombs become `invalid_frontmatter` errors). Unknown front matter keys go into `deck.*`, so the validator's "allowed fields" message applies. Cards start at `## id`; fields start at a label at the start of a line (Type, Q, A, Answer, Accept, Cloze, Choices, Explanation, Extra, Hint, Tags, Source, case-insensitive). Code fences are opaque. The one escape is a leading backslash, removed exactly once, so any text can be stored. Anything outside a card or field is an error rather than silently dropped. The reader and writer share their line rules in `markdown-syntax.ts`, so they cannot drift apart.

**Serializers (`core/parse/serialize.ts`).** `serializeJson` writes keys in a fixed order. `serializeMarkdown` returns the reasons a deck cannot be written (`leading_space`, `unclosed_fence`, `list_item`, `blank_line_in_choice`, `empty_choice`) instead of producing a file that would read back differently. The deck is still fine as JSON.

**Properties (fast-check 4.10.2, dev dependency, seeded so failures reproduce).** JSON round trip exact; Markdown round trip equal after `normalizeCard` (tags and accept as sets, text trimmed, NFC); both formats parse to the same deck; write, read, write is a fixpoint; and for any text at all, a deck either round trips or says exactly why not. Generators put awkward lines (labels, headings, fences, backslashes) into every text field. Run at 3,000 cases for each of 7 further seeds: no counterexample.

**Flaws the properties found (fixed):** a code fence that opens on the first line of a choice (after the bullet) paired the wrong fences. Fence state is now tracked on the choice text, not on the bullet and indent, in both reader and writer. Inner whitespace of choices was being trimmed; now only the end of the whole choice is.

**Import (M2-08).** `handleImport` maps the content type to a reader with a `Map` (so `constructor` or `__proto__` as a content type cannot match an inherited name). The server never guesses the format; the client says. `core/parse/detect.ts` is used by the import page only: first line `{` or `[` is JSON, first line `---` is Markdown, then a `tessera:` or `"tessera":` marker anywhere (an introduction from Claude may come first), then the file extension, then JSON by default. The page shows "Reading this as Markdown/JSON." and imports `detect.ts` directly so the browser bundle does not carry `yaml` or the validator.

**Mutation check.** 66 deliberate bugs across reader, shared rules, and writer: 47 caught first time, 19 survived. Each survivor was either a missing test (added: Type case, choice trailing space, fence indent rules, wrapper fence mismatch, size boundary, error order, blank line under a heading, `...` end marker, strict `---` start, list split on line breaks, long title folding, CR handling, empty choice) or an equivalent mutant. After the new tests 18 of those 19 are caught; the last one (`correct: marked[0]` when several choices are marked) is equivalent, because the multiple-correct error is returned before the value is read. A control run with no change survived, as it should.

**Security.** New attack surface is the YAML parser on a network boundary. Probe now sends a 6 MB body, a YAML alias bomb, 100,000 nested brackets, unknown and custom YAML tags, `__proto__` and `constructor` keys, 200,000 empty cards (error list capped at 50), a 2 MB line, SQL metacharacters in ids, and `text/plain`. All refused cleanly and quickly.

**Tests added:** parse-markdown 90, serialize 24, detect 12, 14 API integration tests, 9 browser tests (`tests/e2e/import-markdown.spec.ts`). Totals: 658 unit, 269 integration, 61 e2e, probe 156 checks, smoke, durability, ops, licenses and `npm audit` clean.

**Not done here:** documentation of the format for authors is M2-13 (`docs/deck-format.md` and the Claude skill). Export is not exposed in the UI yet; the serializers exist for it.

## M2-09 and M2-10 Import preview detail and the study screen for typed and choice cards (2026-10-11)

**M2-09, what the preview now says.** The import plan (`server/import/plan.ts`) gives each updated card its changes as old and new text (`changes`), and each retyped card the number of review items that have history and will be erased (`progressLost`). Three new warnings, all computed from the same plan that the commit re-runs, so the preview cannot differ from the import:

- `type_changed`: names up to five cards, says how many review items lose history, or that none was studied.
- `ids_changed`: a new card whose content hash equals that of an active card missing from the file is that card under a new id. Each missing card is matched at most once. The message names the first pair and says what happens to the old cards (kept, or archived when the option is on).
- `mostly_replaced`: at least half of a deck of three or more active cards is missing, and the file adds three or more new cards, and no id match was found. Covers a rewritten deck where the text also changed.

Cards that are already archived are not counted as missing. Thresholds are guesses, not measurements. They are tested at their edges, but whether half and three are the right numbers for a real revised deck needs real use.

The API summary keeps the reply small: text cut at 300 characters with a `cut` flag, old and new text for the first 50 changed cards only (the page shows 50), at most 200 missing cards listed (`counts.absent` has the full number). The page shows a Show what changes section per card (Before and After labelled in words, not only by colour), a Progress starts over notice, and a Not in this file list that says whether the cards will be archived.

**M2-10, how typed and choice cards work.** `ui/study-card.ts` is pure and unit tested. It wires `core/typed-match.ts` and `core/choice.ts` to a study item and returns an outcome with a suggested grade. The page:

- Typed: the answer box takes focus when the card appears. Enter checks it. The result, what was typed, the answer, and the accepted alternatives are shown, and the suggested grade button gets focus. "I don't know" shows the answer and suggests Again. Letters and digits typed in the box never trigger shortcuts.
- Choice: the options are shuffled with `choiceSeed` (card, blank, and review count), so a refresh keeps the order and the next review reshuffles. Keys 1 to 9 choose. The right option and a wrong choice are marked with words ("Right answer", "Your answer") as well as colour. The explanation is shown. After the answer the options are disabled.
- Both: the suggestion is shown in words and highlighted. The learner can press any of 1 to 4. Space and Enter give the suggested grade (Good after a right answer, Again after a wrong one), and the hint line says which. The typed text is sent with the review (`typedAnswer`, already stored by the server and never logged).
- Choice text renders inline with links removed (`renderInlineMarkdownWithoutLinks`), so no link is nested inside a button.
- `cardSides` for a choice card is now only the question and the explanation, because the page shows the options itself.
- The render-failure fallback badge named in the task already existed in `Markdown.svelte` and is covered by an existing browser test.

**Behaviour to know about.** Good, Hard, and Again leave a new card in a learning step, and with nothing else due it is offered again straight away (existing behaviour, ADR-003). Only Easy graduates it. A typed or choice card therefore returns with a fresh attempt after the first grade. The browser tests were wrong about this twice before they were fixed.

**Mutation checks.** M2-09: 20 injected bugs in the plan and summary code, all caught on the first run. M2-10: 11 in `study-card.ts`, 10 caught, and the survivor (choices shown unshuffled while grading used the shuffled order) exposed that my test used one seed whose shuffle may be the identity. A test over 30 review counts now covers it, and all 11 are caught. The page itself (focus, keys, markup) is covered by the browser tests, not by mutation.

**Tests added.** 12 plan tests (preview.test.ts), 6 API tests (import-preview), 5 plus 2 browser tests for the preview, 15 unit tests for `study-card`, 3 for link-free choice text, 17 browser tests for the four card types (keyboard, override, reload, links, axe in both themes, 320px). Totals: 673 unit, 290 integration, 87 e2e, probe 156, smoke, durability, ops, licenses, audit clean.

**Not done.** Mermaid and code highlighting are M2-11. A choice option with a code block or a list is shown as inline text. `docs/deck-format.md` and the Claude skill are M2-13. There is no screen reader test (QA gap carried over).

## M2-11 Mermaid and Shiki under the CSP (2026-10-11)

Decision record: ADR-010. No change to the Content-Security-Policy.

**What was built.** `ui/code-blocks.ts` (loaded by `Markdown.svelte` after the text is on the page, only for text with a code fence):

- Highlighting: Shiki 4.5.0 core with the JavaScript regular expression engine, so `script-src` needs no `'wasm-unsafe-eval'`. 23 grammars, each loaded only when used. The highlighted code is built from DOM nodes with `textContent`, never from an HTML string. Token colours are accepted only as hex and set as custom properties, chosen by `light-dark()`. Unknown languages, over 20,000 characters, or over 600 lines stay plain.
- Diagrams: Mermaid 12.1.0, strict, HTML labels off, at most 8,000 characters and 200 edges, one at a time, 8 second timeout. The SVG is sanitized again and shown as an image through a `data:` URI, so a diagram cannot run script, load anything, or restyle the page. Drawn again when the colour scheme changes. A failure shows the source with a note. The source is also under "Diagram source" on a diagram that drew.
- `Markdown.svelte` also gained: no code ligatures (`->` and `!=` stay as written), and global styles for the pieces built in script (Svelte's scoped CSS does not reach them, which showed up in a screenshot).

**Both libraries are development dependencies** (compiled into the browser bundle, never loaded by the server, so not in the runtime image or the production licence check). MIT. `npm run audit:prod` still finds 0. `npm audit` now also lists a low severity `katex` advisory through Mermaid, recorded in ADR-010.

**Measured.** A plain card downloads 194 KB of script (65 KB on the wire). A code card adds about 370 KB (64 KB on the wire). A flowchart adds about 2.1 MB (about 494 KB on the wire). A test fails if a plain card starts downloading the diagram library.

**Found by looking and by testing, not by reasoning:**
- A sequence diagram failed to draw because its `viewBox` starts at a negative origin and my size parser rejected it. Every other type drew. All seven common types (flowchart, sequence, state, class, entity relationship, pie, Gantt, mind map) are now checked in a real browser.
- Axe found the light theme's comment grey at about 4.3 to 1. A unit test then found three more colours in the two themes that are unreadable on our code background (near white or near black, meant for a background the theme paints and we do not). They are replaced per theme, and the test now checks every colour of both themes against the real background colours, so a theme or colour change cannot reintroduce it.
- The "could not be drawn" note was big and black because scoped CSS did not reach elements created by script.
- jsdom has no `matchMedia`, so the scheme code guards for its absence.

**Mutation check.** 17 injected bugs in `code-blocks.ts`. First run caught 8. The survivors showed missing tests for a prototype-name lookup in the alias table (fixed in the code as well, because `ALIASES['constructor']` returned a function), the colour check (now exported and tested with hostile strings), font styles, and the case of a mermaid fence. After that 12 of 17 are caught. The rest: removing either of the two overlapping SVG forbid lists alone changes nothing (removing both together is caught), dropping the `style` tag allowance changes nothing (DOMPurify's SVG profile keeps it), and showing a drawn diagram after the card was replaced can only be reached in a real browser, where the success path runs.

**Tests added.** 42 unit tests for `code-blocks` plus 5 contrast tests (colours of both themes), 13 browser tests: drawn under the unchanged policy with no violation and no outside request, policy header has no `unsafe` keyword in `script-src`, redrawn for the other colour scheme, mistake shows source and the card still works, over-size refused quickly, hostile diagram text (HTML in labels, script, click handlers, javascript links, external `url()` in `classDef`) runs nothing and reaches nowhere, wide diagram on a 320 pixel screen, highlighted text equals the written text, unknown language stays plain, code that looks like markup stays text, lazy loading, axe in both themes.

**Not done.** `docs/deck-format.md` (M2-13) should say which languages are highlighted and which diagram types were checked. A card with a code block inside a choice option is still shown as inline text. The app has no favicon, so every first page load requests `/favicon.ico` and gets a 404 (found while chasing a console error, unrelated to M2-11).

## M2-12 API token (2026-10-11)

ADR-009 decided what the token covers. ADR-011 refines how the server recognizes its own web page, because running a real browser against a real built server showed ADR-009's rule did not work on the main deployment.

**What was built.**
- `server/http/auth.ts`: `requiresToken` (judges the path the way the router sees it), `bearerToken`, `tokenMatches` (SHA-256 digests compared with `timingSafeEqual`), `isWebPageRequest`. `apiTokenGuard` in `hooks.ts`, placed after the host check and before the content type check. A refusal is `401` with `WWW-Authenticate: Bearer realm="tessera"` and the usual JSON error. The refusal is logged with the request id, method, path, and whether a token was sent, never the token. The startup log says a token is set.
- The web app adds `X-Tessera-Client: web` to every API call (`ui/api.ts`, `core/client-header.ts`).
- Open paths: everything outside `/api`, and exactly `/api/schema`. `/healthz` is not under `/api`.

**Three things the real browser showed that the unit tests did not (all in ADR-011):**
1. Browsers send `Sec-Fetch-Site` only to HTTPS and localhost, so over `http://192.168.x.x` it is absent. A same-origin GET carries no `Origin`. The page would have been locked out of its own API. Fixed with the marker header, which a page on another site cannot send (it would need a CORS preflight, which Tessera never grants).
2. `adapter-node` assumes `https` when `ORIGIN` is not set, so `event.url.origin` was `https://…` on a plain HTTP server and no browser `Origin` ever matched. The unit tests used `http://localhost`. Fixed by comparing the Origin's host and port with the Host header, ignoring the scheme. The browser test over the machine's LAN address failed until this was fixed, and a probe check and an integration test now reproduce the cause.
3. SvelteKit's own CSRF layer answers 403 to a form-typed cross-site post before any hook runs. That is fine, and the tests accept 401 or 403 there.

**An honest limit, documented and tested.** A client that copies the browser's headers is accepted. The token stops honest scripts and other websites, not a hostile client on the network. That is inherent without a login, it is what ADR-009 decision 6 meant, and the deployment guide and README now say it. A probe check asserts it, so the documentation cannot drift from the behaviour. ADR-009's wording that the headers "cannot be forged" was true only of page script.

**Path variants.** SvelteKit decodes the path before matching (`/%61pi/decks` reaches `/api/decks`). The guard decodes the same way and fails closed. Tested through the real router with `/%61pi/decks`, `/ap%69/decks`, `/api/%64ecks`, and others.

**Mutation checks.** 14 injected bugs in `auth.ts` and 9 in the hook, startup log, and pipeline: all caught after three added tests (an undecodable path outside `/api`, the no-token case stated explicitly, and the pipeline order, which only the unit test that reads `hooks.server.ts` can see).

**Tests added.** 40 unit (`auth.test.ts`), 49 integration with the real hook chain and a token (`api-token.test.ts`), 11 browser tests against a second server with a token (`api-token.spec.ts`: the page imports and studies on loopback and over the machine's LAN address, the token is not in the page or scripts, scripts with and without the token, encoded paths, a preflight is granted nothing, a cross-site fetch cannot read or carry the marker, a cross-site form post imports nothing), and 60 new probe checks (now about 215 in all). `playwright.config.ts` starts that second server on port 4178.

**Not done.** No lockout or delay for repeated wrong guesses (tested that 400 wrong guesses change nothing for the right one). The token cannot be sent through a reverse proxy that uses HTTP Basic authentication, because both want the `Authorization` header. Documented. No rotation tooling: change the setting and restart.

**Housekeeping found on the way.** The probe's earlier form-post check is covered by two independent layers (SvelteKit 403 and the token guard), and the tests say which answered. `pkill` does not exist in this shell, so a stray test server kept a port and nearly hid a result, so stray servers are now stopped by process search first.

## M2-13 Claude skill, format reference, workflow guide, golden decks (2026-10-11)

**Delivered.**
- `claude-skill/tessera-deck/SKILL.md`: self-contained (Claude will not have the repo open), so it carries the whole format, the card-writing rules, the id and revision rules, a table of import error codes and their fixes, the limits, and a checklist. Default output is Markdown (code and quotes need no escaping), wrapped in a four-backtick fence when the deck has code blocks.
- `docs/deck-format.md`: the reference for both formats.
- `docs/claude-workflow.md`: how to ask, import, fix, check, and revise, for the person using it.
- Three golden decks in `examples/`: `ccna-ospf` (11 cards, in JSON and in a generated Markdown twin), `powershell-essentials.md` (16 cards, code blocks), `tcp-ip-fundamentals.json` (15 cards, sequence diagrams, a table). Together they use all four card types, multi-blank cloze, `accept`, explanations, code, tables, and diagrams.
- README rewritten around the guides and the skill.

**Documents cannot drift from the code.** `tests/unit/docs/docs-and-examples.test.ts` (34 tests): every example deck is parsed by the real parser and survives a trip through the other format; the Markdown twin must equal what the writer produces; every complete deck shown in a document (tagged `tessera-deck`) must import, and the Markdown and JSON examples in the reference must be the same deck; the languages, short names, labels, limits, and quoted error messages in the documents must match the code; the error codes the skill names must exist in the source; relative links must resolve; the skill must have a valid name and description. Negative control: 12 deliberate mistakes in the documents (a changed limit, a removed language, a renamed label, a changed message, a broken link, a missing `[x]`, a skill error code that does not exist, a drifted Markdown twin and others) are all caught. Three of my first patterns did not match because Prettier had re-aligned the tables, so those were redone, and one survivor (README link target) led to a link-existence test for the README.

**Found while writing the golden decks, and fixed.**
1. **Prettier silently corrupts a Markdown deck.** Running it over `examples/powershell-essentials.md` added blank lines (harmless) and indented the lines after the last choice, which made `Explanation:`, `Source:` and `Tags:` part of that choice. The import would have "worked" and given a wrong deck. Two changes: the parser now refuses an indented line under a choice that looks like a label (`label_in_choice`, with a message that says what to do), and the writer escapes such a line with a backslash so any text still round-trips. Escape rule added to `markdown-syntax.ts`, covered by 9 parser tests, 1 writer test, the property tests (5 seeds at 3,000 runs), and a mutation check (5 of 5 caught). Prettier is told to leave `examples/*.md` alone, and the doc examples are marked `prettier-ignore`. The reference and the skill both warn about it. A one-space indent was already refused (`invalid_choice_line`); four spaces or more is kept as part of the choice.
2. **"Copy errors for Claude" always asked for JSON back**, even for a Markdown deck. It now asks for the format that was imported, and mentions the four-backtick fence rule.

**Not done / honest limits.**
- The skill was reviewed against the schema and the parser by tests, but it has not been tried on a real Claude conversation. That is the real test and needs the owner: ask Claude, with the skill, for a deck from some notes, and import it. The skill's advice (default to Markdown, four-backtick fence) is my judgement of what is least error-prone for a model, not a measurement.
- The decks' facts were checked by me, not by a subject expert (PowerShell execution policy wording, OSPF states and timers, subnet sizes, ports). Anyone using them to study should check them.
- Skill installation instructions are stated generally (a Claude app's own skill mechanism, or paste the file) because I could not verify any one app's menu.
- Export is not built, so the workflow guide tells people to keep the file they imported. The weak-spot round trip is M3.

## M2-14 End-to-end coverage and Firefox and WebKit in CI (2026-10-11)

**Coverage.** Most of the task's coverage already existed from M2-05 to M2-13: all four card types studied end to end (`study-card-types.spec.ts`), Markdown import by paste, file, fenced block, byte order mark and Windows line endings (`import-markdown.spec.ts`), the import preview (`import-preview.spec.ts`), the golden decks (`golden-decks.spec.ts`), diagrams and code (`diagrams-and-code.spec.ts`), the token (`api-token.spec.ts`). The one thing missing was a **keyboard-only run through everything**, now `keyboard-only.spec.ts`: paste a Markdown deck with all four card types, Preview and Import by Tab and Enter, follow the link to study, answer a basic, a cloze, a typed (typed in a different case, Enter) and a choice card (the number key of the right option), grade each with a key, and return to the deck list. Nothing clicks. A second test pins the focus order on a typed card (answer box, Check answer, I don't know).

**Three browsers.** `playwright.config.ts` runs one browser per invocation, chosen by `E2E_BROWSER` (Chromium by default, so existing commands and the verify job do not change). Reason: most e2e tests import decks with fixed ids into one shared server, so two browsers in one run would meet each other's data. `scripts/run-e2e.ts` runs a list of browsers one after another, each with its own servers on an empty data folder. New scripts: `test:e2e:firefox`, `test:e2e:webkit`, `test:e2e:all`. CI has a new `browsers` job, a matrix of Firefox and WebKit with its own 20 minute budget, running at the same time as `verify` (the release workflow calls CI, so a release is now gated on all three too). Policy tests pin it.

**What the other browsers found.** WebKit (Playwright's build, Safari's engine) passes all 118 tests after changes that reflect real browser differences, not hidden problems:
- **Safari does not Tab to links by default** (people use Option+Tab, or turn the setting on). The skip link, "Study this deck", and "All decks" are links, so in WebKit those tests focus the link directly and check it works. This is a browser setting, not an app fault, and the README says so. Buttons and fields are reached by Tab as usual.
- **Only Chromium can be granted clipboard access** in Playwright. Chromium still verifies the clipboard contents. The other browsers must show either "Copied" or the manual-copy fallback, either of which gives the person the message.
- A test that ran axe on `/import` before the client-rendered page existed saw an empty document in the slower browser. It now waits for the heading. (This kind of race is why retries are off.)
- The golden-deck rendering test had two faults of mine: it depended on a deck created by another test, and its loop could act on the card just answered, which stays on screen with disabled buttons until the next one arrives. It was flaky in Chrome too (2 failures in 3 early runs). Fixed by importing its own decks and waiting for the grade buttons to go before acting. 12 of 12 runs pass afterwards, and the keyboard test, which had the same hazard, got the same guard (10 of 10). The failing step now reports what the page was showing.

**Firefox is not verified locally.** Playwright's Firefox build will not start on this machine: Windows reports "side-by-side configuration is incorrect" for `firefox.exe` itself, although the Visual C++ 2022 runtimes are installed and Firefox ships its own copies. Diagnosing it needs administrator tools, and I did not install system runtimes. So the Firefox tests have never run. They run for the first time in CI on Linux. I read the tests for Firefox-specific traps (clipboard permission, links in Tab order, `Sec-Fetch-Site` rules on plain HTTP, `light-dark()` support from Firefox 120) and found nothing beyond what is already handled, but that is reading, not running. Expect the possibility of a CI fix.

**R-1 closed in part.** The minimum browser versions are in the README and the deployment guide (Chrome and Edge 123, Firefox 120, Safari 17.5, from `light-dark()`). Chrome and WebKit are verified. Firefox is verified only once the new CI job is green.

**Not done.** No real Safari, iPhone, or Android browser. Playwright's WebKit is the same engine but not the same product. No screen reader. The WebKit test for the LAN-address premise passed, which suggests WebKit also sends no `Sec-Fetch-Site` there.

**Follow-up to M2-14 (2026-10-11): Firefox passed.** CI run 38182773425 on the pushed M2-14 commit was green, including the new Firefox and WebKit jobs on their first run (Verify, Browser tests in firefox, Browser tests in webkit, Docker amd64, Docker arm64). So all 118 browser tests pass in Chrome, WebKit, and Firefox, and QA risk R-1 is closed. The Firefox launch problem on the development machine remains a local-only fault.

## M2-15 Release pipeline (2026-10-11)

Nothing was published, tagged, or released. The task's own condition ("publication happens only after approval") is unchanged: `v0.1.0` is the M2-16 exit, and only on the owner's approval.

**What already existed from M1** (and was rehearsed on 2026-10-11): the tag-driven `release.yml` (CI first, tag and changelog checks, multi-arch build, provenance and SBOM, push to GHCR on a tag only, GitHub Release from the changelog section). The task added what was missing.

**Release assets.** `scripts/package-release-assets.ts` builds `tessera-deck.v1.schema.json`, `tessera-deck-skill-<version>.zip` (the skill with a `tessera-deck/` folder at its root, as a skill upload expects) and `SHA256SUMS`. It uses a small zip writer in `scripts/lib/zip.ts` (Node's `zlib`, no program or package needed), which writes fixed timestamps and sorted entries, so the same inputs always give the same bytes. It refuses unsafe paths, duplicate names, and a version that is not a plain `x.y.z` or `x.y.z-suffix` (the version ends up in a file name). It checks that the schema is the deck schema and that `SKILL.md` names `tessera-deck` before writing anything. `release.yml` runs it on a rehearsal as well as on a tag, verifies the result with `sha256sum -c` and with `unzip -t` (a zip reader that is not ours), and on a tag attaches the three files to the release.

**Image scan (security finding S-05).** The CI `docker` job now scans the built `tessera:ci` image with Trivy (OS and library packages) and fails on **high or critical findings that have a fix available**, so a failure always asks for something doable. One architecture is scanned. The release workflow runs CI first, so a release cannot go out with such a finding. The action is pinned to the v0.36.0 commit. **This step has never run**: there is no container program on this machine, so it was checked by reading and by tests of its configuration. Its first run is the next CI run. Risks I cannot rule out from here: the vulnerability database download can be rate limited on GitHub (the action caches it), and the base image (`node:24-trixie-slim`) can have a fixable high finding on any given day, which would turn CI red until a rebuild picks up the fix.

**Validation without running GitHub.** `tests/unit/deploy/workflow-references.test.ts` checks every reference every workflow makes against the repository: needed jobs exist, called workflows exist, every `npm run` script is in `package.json` (with matrix values expanded), every `node scripts/...` file exists, matrix keys used are defined, step outputs are only used after their step, and no pull-request-controlled value goes straight into a shell command. It also checks that the release workflow packages before it attaches and attaches exactly the files the script writes. `ci-policy.test.ts` pins the scan's settings and position. Negative control: 12 deliberate workflow mistakes (a matrix key typo, a missing script, a missing job, a scan that ignores HIGH or cannot fail or scans another image or runs on every platform, a script name typo, checksums not attached, no checksum or unzip check, an output of a step that does not exist), all caught.

**Verified by hand.** The script was run, the checksums verified with `sha256sum -c`, two runs compared byte for byte (identical), and the zip extracted by Windows' own `Expand-Archive` (a separate implementation), which gave the right folder and a file identical to the source. 28 unit tests cover the writer (against a separate reader written for the test, including checksums), the script, and bad versions.

**Not done / still needs the owner.**
- The first CI run with the scan, and a manual rehearsal of `release.yml` with the new step, have not happened (they need GitHub). Both are on the first-release checklist in `docs/releasing.md`.
- `packages: write` for the release job is still unverified until a real tag, as before.
- No exception mechanism for the scan (a `.trivyignore`) was added, on purpose: an exception should be a decision with a reason, made when a real finding appears.

**Follow-up (2026-10-11): the first CI run of M2-15 failed, three fixes, now green.** CI run on ad454a0 passed every job.
- **E2E flake in the LAN-address test (the M2-12 failure the owner reported).** Cause: the test read `request.allHeaders()` inside an event handler, so a read could still be pending when the test ended ("Test ended"). Fix 2168b2a collected requests and read headers after the flow. That exposed a second cause: `allHeaders()` waits for the browser's raw-header event, which never comes for a request cut off by navigation, so it hung to the 45 s timeout. Fix ad454a0 collects on `requestfinished`. It was only diagnosable after adding the Playwright `github` reporter in CI, because job logs need a login while annotations are readable anonymously.
- **Image scan.** The first scan failed with real findings (undici, tar, ip-address, brace-expansion) inside the npm, corepack, and yarn copies in the base image. The scan gate was first split into scan plus a check script (`scripts/lib/image-scan.ts`) so a failure names the packages as annotations. The runtime stage now deletes npm, corepack, and yarn (the server and health check use node only); the build stage keeps npm; a policy test guards it (ab21775). The scan now passes: no fixable high or critical finding in 2 targets (Debian 13.7 and Node.js libraries). arm64 is not scanned, by design.
- **Process lesson.** Commit e5c3172 went out with 9 type errors because `npm run check | tail` hid the exit code (fixed in ba10059). Check `$LASTEXITCODE` and run the full `npm run verify` before every push. Bash heredocs also mangle backslashes, so content with escapes is written with the Write/Edit tools.

## M2-16 Exit gate evidence (2026-10-11)

Nothing was tagged or published. The two exit reports are `.10x/reviews/2026-10-11-qa-report-m2.md` and `.10x/reviews/2026-10-11-security-review-m2.md`.

**Mutation check of the M2 logic.** 26 deliberate bugs (typed matcher, API token and web page detection, host check, choice shuffle and grading, format detection, Markdown parser errors). 22 were caught the first time. Of the four survivors, three were real test gaps and now have tests (a trailing hyphen is kept in a typed answer, `.localhost` stays loopback when an allow-list is set, a `---` start without a `tessera:` line is Markdown), and one is harmless (skipping every code fence line instead of one at the start of a pasted deck gives the same answer for every input a person pastes). The three were re-run and are caught.

**KaTeX payloads.** The hostile diagram browser test now includes math labels with every KaTeX trust feature. The diagram draws and the SVG has nothing executable or remote in it (also checked by hand against the built server).

**Soak.** Four minutes, four workers, 54,338 successful requests, 692 re-imports, 0 unexpected statuses, 0 error log lines, memory flat at about 315 MB after start-up. The soak script is a scratch file, not in the repository. A multi-day soak and a disk-full run are still the owner's.

**Version.** `package.json` and the lockfile are at 0.1.0 and the changelog has a `## [0.1.0] - 2026-10-11` section, **uncommitted on purpose**, until the owner approves the tag. `npm run verify` passes with them and the release assets build for 0.1.0.

**Open for the owner:** `docs/security.md` (ADR-005 promises it), log rotation in `compose.yaml` (S-11), accept S-10 and S-04, and the checks only they can do (see the handoff).

## 0.1.1 (2026-10-11)

Spec: `.10x/specs/2026-10-11-v0.1.1-and-live-test-design.md`. ADR: `.10x/adrs/012-live-image-test-harness.md`. Version in the repository: `0.1.1-rc.1` (a release candidate, so the fixes can be tested on a real host before the final release). Nothing is final until the owner approves.

**Built, each test-first and each with a negative control (the new test failed before the change).**
- **B-1** `openDatabase` creates `<dataDir>/backups`; a file in the way is a clear error. New integration tests run the operations guide's own backup and check commands (extracted from the guide) against a fresh data folder. `ops-check` now takes its backup into that folder. Three older tests that asserted "no backup" by the folder not existing now assert the folder is empty.
- **S-11** `compose.yaml` rotates logs (10 MB times 3), pinned by the container policy test and described in the operations guide.
- **D-1** The deploy guide shows the published-image compose file, with a test that keeps every hardening setting equal to `compose.yaml`.
- **F-1** The tab icon was the SvelteKit starter's Svelte logo (the owner saw it). Replaced by Tessera's mark with its own background, tested as a file and as what the page really serves, and looked at at 128, 32, and 16 px on light and dark strips.
- **Disk full (found by the harness, not planned).** A full data volume answered a generic 500. `toErrorResponse` now recognizes `SQLITE_FULL` and `ENOSPC` (however deeply wrapped, bounded depth) as HTTP 507 `storage_full`, and `SQLITE_READONLY*` and `SQLITE_IOERR*` as HTTP 503 with a plain message, no internals. Troubleshooting rows added.
- **Probe remote mode.** Against `--base` the probe used to skip about 90 checks silently (guards on a local child process), and its token and host-list variants would have tested the local build while claiming to test the remote server. It now takes those servers and their logs from flags, reports anything it cannot run as SKIP with a reason, and `npm run probe:remote-check` (in CI) proves it with local stand-ins. A deliberate break of the remote mode failed two of its checks.
- **B-2 The harness** `scripts/live-test.ts` with `scripts/lib/live-test.ts`: safety rules (live port, live folder by name and by resolved path, fixed test folder and project, marker file, ssh target check), the compose file generated from the repository's own `compose.yaml`, command strings, and extraction of the guide's commands. About 60 unit tests (library and command line), and about 22 deliberate bugs planted in its rules, each caught or shown equivalent (one dead condition removed). `docs/testing-on-your-host.md` explains it.

**What the harness found on the real host (CT123, nested Docker in an unprivileged LXC).**
1. The published 0.1.0 image passes every hardening check as Docker applies it: non-root, read-only root, no capabilities, no-new-privileges, 512 MB limit, restart policy, log rotation, ports. Smoke, 214 probe checks, and the benchmark pass over the network. The test instance ran the same image digest as the live instance.
2. B-1 confirmed on the real image: `/data/backups` missing, and the documented backup, copy-out, and restore steps failed as a result.
3. Full disk: no crash, no restart, reads work, imports work after space is freed, integrity check ok, but the answer was a generic 500 (fixed above).
4. A harness mistake, not an app fault: after `docker kill -s KILL` Docker does not restart the container, because it treats an explicit kill as a manual stop. The harness now simulates a crash by killing the server process inside the container (the restart policy applies) and treats `docker kill` as a separate, expected-stopped case.
5. The first runs also taught the harness three things: `/opt` is root-owned on the host (the test folder is now `~/tessera-test`); a build on the LXC hung in `npm prune` for half an hour waiting on the network (cause not found, probably the route to the npm registry from that container), so the harness cancels a hung build on the host after 15 minutes and keeps the log; and giving up locally had left that build running on the host until it was stopped by hand (about 544 MB of build cache remains on CT123).

**Not done.** The 0.1.1 fixes have not yet been run on the real host. The release candidate `v0.1.1-rc.1` exists for that. No soak has run on the real host yet.

**Tech debt.** The harness is not covered by CI (CI has no homelab). Only its pure parts, its refusals, and the probe's remote mode are.

## 0.1.1 released (2026-10-12)

`v0.1.1` is published (stable release, image `ghcr.io/drewsweeney33/tessera:0.1.1`, with `0.1` and `latest` moved to it). The release candidate went first and the final image passed the live-image harness on the real host again: 63 passed, 0 failed, 1 skipped. See the QA report addendum. The owner's live instance on CT123 is still on 0.1.0 until the owner upgrades it (steps in the handoff). Later the same night the owner added library management requests to the plan (ADR-013 and ADR-014 proposed, tasks L-01 to L-10). Nothing from them is built.

## L-01 export (2026-10-12)

Milestone L (library management) started on the owner's go-ahead (ADR-013 and ADR-014 accepted). Order: L-01, L-03, L-02, L-04, L-05, L-06, L-07, L-08, L-10, then L-09. Each task test-first, committed on its own.

**Built.** `exportDeck` (`src/lib/server/export/deck.ts`) reads a deck back as a deck document: stored card `{ type, id: key, ...content, tags, source }` in position order, archived cards left out, a deck in the Trash or unknown gives nothing (one 404 for both). `renderDeckExport` writes JSON or Markdown with a safe file name (the deck id) and says which card blocks a Markdown export. `handleExportDeck` and the route `src/routes/api/decks/[id]/export/+server.ts` send it as a download with `Cache-Control: no-store`. A card imported without an id is exported under its stored `h-` key, so exporting and importing again keeps it.

**Checked.** The round trip on every golden deck and on generated decks of all four card types; a trip through JSON text and through Markdown text; mutation check of 13 planted bugs (12 caught; the other, content spread before `type`, cannot matter because stored content never has a `type` key). The security probe gained 27 checks (242 in all) including token and path-variant cases.

**Found and decided on the way.** A `DELETE` that carries a body answers 400 from the framework, not 405. The probe accepts 400, 403, or 405 as a refusal, as its older cross-site check already did. Not a defect: nothing is executed.

**Not done.** No export button in the page (the editor and the Backups page bring it). The guide says so.

## L-03 snapshot helper (2026-10-12)

**Built.** `src/lib/server/backups/snapshots.ts`: `createSnapshot` (a named, consistent copy in `<dataDir>/backups` using the same `VACUUM INTO` as the guide, named `<kind>[-<deck>]-<time>[-<n>].db`, never overwriting, leaving nothing half-written on failure), `withSnapshot` (takes the snapshot first and runs the action only if it succeeded), `listSnapshots` (newest first, with kind, size, and time; folders, hidden files, and names that would not be served are left out; a missing folder is an empty list), `isSafeBackupName` and `BACKUP_NAME_PATTERN` (letters, digits, dot, underscore, hyphen, 120 characters at most, ending in `.db`, no `..`, never the live database file), and `snapshotKindOf`. A snapshot subject must pass the deck id rules, so nothing but a safe id ends up in a file name.

**Checked.** 46 tests, including that a full disk (injected `SQLITE_FULL`) stops the action and gives a plain 507, that a half-written file is removed, that an error from the action keeps the snapshot, and that unsafe names are refused (traversal, backslash, percent-encoding, NUL, over-length). Mutation check of 14 planted bugs: 13 caught at first, and the survivor (removing the `..` rule, which no test case exercised) got two test cases and is now caught.

**Process note.** A temporary edit to an untracked file was not undone by `git checkout` (it only restores tracked files) and was restored by hand. Mutation scripts that restore from an in-memory copy are safe. Hand edits to untracked files need a copy first.

**Not done.** Nothing calls it yet. L-06 (permanent delete), L-07 (start over), L-08 (the Backups page), and L-09 (restore) will.

## L-02 create a deck by hand (2026-10-12)

**Built.** `slugifyTitle` (`src/lib/core/slug.ts`, shared by the form and the server), `createDeck` (`src/lib/server/decks/`), `POST /api/decks` (201 with the deck as the home page lists it, 409 for a taken id with the field named, 422 naming every bad field, 413 over 16 KB), the `conflict` error code (409), the page `src/routes/decks/new/`, a "New deck" link on the home page in both states, and "No cards yet" for a deck with none. The id is made from the title and shown while typing; a taken or invalid id is explained beside the field; the owner's typing is kept on an error.

**Decision.** The deck file schema requires at least one card and is the public format served at `/api/schema`, so it was not loosened. A deck made by hand is created directly with the same rules for id, title, description, and tags (the other option ADR-013 allowed). A deck in the Trash still owns its id, so a title that slugs to it gets a number rather than reusing it.

**Found on the way.**
1. `exportDeck` (L-01) would have crashed with a 500 for a deck with no cards, because such a deck cannot validate as a deck document. It now answers 409 with a plain message (tests first).
2. A chunked upload over a small route limit (16 KB here) gets its connection reset instead of a 413 when sent chunked. With a `Content-Length` (browsers, curl) it is a proper 413. It already behaved this way on `/api/study/review`, so it is not new. Logged as backlog item B-3.
3. The probe's remote-mode check ran the probe twice on one server, and the second run correctly got `probe-made-by-hand-2`. The probe now uses the id it was given, which also makes it safe to re-run against a server it has touched.
4. Two of my e2e tests collided on the shared server (a deck title contained another spec's search text). The title was changed.
5. The home row read "0 cards· ccna" (no space before the dot), an existing cosmetic bug, fixed with a separator element.

**Checked.** 22 slug tests including two property tests (a valid id for any text; idempotent); 26 service and handler tests; mutation check of 13 planted bugs (all caught after a second look at two whose text had not matched); 11 browser tests for the page; the page is in the accessibility scans (light and dark) and the layout checks at 320, 375, 414, and 768 px; probe 272 checks (30 new, including the token, cross-site, hostile body, SQL, markup, and foreign host cases); the whole browser suite passes on Chromium and WebKit (132 each). Rendered and looked at on a desktop and a phone, light and dark.

**Not done.** No way to add cards from the page yet (the page says to import a file with the deck id). L-04 and L-05 bring the editor.

## L-04 and L-05 the editor (2026-10-12)

**Built.** The pure part first: `src/lib/core/deck-edit.ts` (`newCardId`, `blankCard`, `tidyCard`/`tidyDeck` for what a save sends, `cardProblems`/`deckProblems` using the deck format's own limits and messages, `changeSummary`, `cardPreviewText`). Then `CardEditor.svelte` (fields for the four types, a live preview built from the same `cardSides` the study screen uses, so it also gets the same Markdown sanitizing), `src/lib/ui/ImportPlan.svelte` (the dry-run view, moved out of the Import page and shared), `api.getDeck`, `expectedRevision`, `fetchFile` and `saveBlob` (downloads go through fetch so the marker header is sent, ADR-011), the page `/decks/[id]/edit`, and an Edit link on every home row.

**Decisions.** A card's type is fixed in the editor (ADR-013: a type change erases history); remove and add instead. The editor sends the whole deck with `archive_missing=true` and the loaded revision, so removing a card archives it and a save from a stale copy is a 409. Closed cards are not checked while typing (only open cards are live, and a failed save opens every card with a problem), so a 5000-card deck stays responsive. The 409 notice stays on screen until the deck is reloaded, because an earlier "Keep editing" button hid the only way to reload (found by the browser test).

**Checked.** 55 unit tests including property tests (a card the editor passes is accepted by the deck schema; `tidyCard` is idempotent; an untouched deck of every fixture saves as no change). Mutation check: 23 planted bugs, all caught (two survivors led to two tests on the accepted-answer limits). 28 browser tests: edit keeps study progress, preview before save, all four types added, remove/put back, empty deck refused, problems beside fields, cloze and choice rules, stale save from a second tab, studying elsewhere is not a conflict, unsaved-changes guard, discard, Markdown preview and markup, 120-card deck paging and search, both exports, keyboard-only save, no overflow at 320/375/768 with every type open. Axe scans of the editor (closed, every type open, with problems, review) in light and dark.

**Found on the way.** axe flagged a skipped heading level (h2 to h4) and four identical "Preview of this card" landmarks; the preview now uses an h3 and no landmark. ESLint required injected randomness in core (`newCardId` takes an rng; the default uses `crypto`), and reactive Map/Set in the page.

**Not done.** No reordering of cards (backlog). No Trash, Start over, or Backups page yet (L-06 to L-08).

## L-06 Trash and L-07 Start over (2026-10-12)

**Built.** Trash: `src/lib/server/decks/trash.ts` (move, restore, list, delete for good), `api/trash.ts`, four routes, the `/trash` page, Move to Trash in the editor, a Trash link on both home headers. Start over: `decks/reset.ts`, `api/start-over.ts`, `POST /api/decks/:id/start-over`, a panel in the editor. Shared: `api/deck-actions.ts` (the 404, the small-body typed-title reader, the mismatch answer). Queries live in the repositories (an ESLint rule keeps Drizzle out of everything else).

**Decisions.** Permanent delete and Start over are POSTs with `{"confirmTitle"}` (a DELETE with a body is unreliable through proxies and the framework answers it 400). A mismatch is a 422 naming the field; a deck not in the Trash is a 409; a trashed deck cannot be started over (404). Neither answer repeats what was typed, and logs carry the deck id and the copy's name, never the title. Trashing sets `updatedAt` to the time it happened, which the Trash page shows. The Trash page is reached with the moved deck's id in page state (not the query string). **Migration `0001_deck_resets`**: the ADR says the kept review log is "marked as before a reset"; a table of reset times does that without touching the log. The migration is the first real upgrade on a live database, so a test now upgrades a database made by the first migration alone through the real folder, with the pre-migrate backup.

**Found on the way.** Importing a file for a deck that is in the Trash did nothing when the file matched the deck (the plan saw no change), although the repository comment and my draft guide said it restores the deck. A test written for the guide's sentence failed. The plan now counts it as a change and the preview warns that the deck is in the Trash. Also: the "Keep editing" button on the stale-copy notice hid the only way to reload (fixed earlier in L-05); the probe's oversized body must carry its true Content-Length (B-3); two of my probe expectations were too narrow (403 and 415 are both refusals).

**Checked.** Trash: 20 service tests and 20 handler tests (15 + 12 planted bugs, all caught or equivalent), 13 browser tests, axe in both themes, 320/375/768 layout. Start over: see the status row. Full gates before the Trash commit: verify, build, probe, Chromium (all), WebKit (all).

**Not done.** The Backups page (L-08), restore from the list (L-09), the harness steps for download, restore, and the 0.1.1 to new upgrade (L-10).
