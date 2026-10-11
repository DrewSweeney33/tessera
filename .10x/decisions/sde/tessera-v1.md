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
