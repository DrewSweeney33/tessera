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
