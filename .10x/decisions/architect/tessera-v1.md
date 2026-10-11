# Architect Decisions: tessera-v1

**Date:** 2026-10-10
**Phase:** 2 Design
**Spec:** `.10x/specs/2026-10-10-tessera-design.md`
**ADRs:** 001 stack and storage, 002 deck format and import, 003 scheduler, queue, cram, 004 container, 005 security

## 1. System context

```
 Claude (external author)                       Reverse proxy / VPN (access control)
   writes deck.json / deck.md                                |
        | paste, file drop, or POST /api/import              v
        v                                      +----------------------------------+
  +---------------------------------------------------------------------------+
  |  Docker container (one Node 24 process, user node)                        |
  |                                                                           |
  |  Browser UI (Svelte 5, client-rendered)      HTTP API (+server.ts)        |
  |        |                                              |                   |
  |        +-------------------+--------------------------+                   |
  |                            v                                              |
  |   src/lib/server:  import | study | stats | export | http (auth, csp)     |
  |                            |                                              |
  |   src/lib/core (pure):  schema | parse | scheduler | cloze | typed | cram |
  |                            |                                              |
  |                      repos (Drizzle)                                      |
  |                            v                                              |
  |                  SQLite WAL  /data/tessera.db  (volume)                   |
  +---------------------------------------------------------------------------+
```

No outbound network calls. No external services. Claude is outside the system boundary and interacts only through files, the import API, the schema endpoint, and the weak-spot report.

## 2. Module boundaries and dependency rules

| Layer | Path | May import | Notes |
|---|---|---|---|
| core | `src/lib/core/**` | nothing outside core, no Node or DOM APIs except `crypto` hashing passed in as a function | Pure and isomorphic. Contains `schema`, `parse`, `scheduler`, `cloze`, `typed-match`, `cram`. |
| server | `src/lib/server/**` | core, third-party | SvelteKit refuses to bundle it client-side. Contains `config`, `db`, `repos`, `import`, `study`, `stats`, `export`, `http`, `log`, `clock`. |
| ui | `src/lib/ui/**` | core (types and pure helpers only) | Svelte components. Never imports server. |
| routes | `src/routes/**`, `src/hooks.server.ts` | server, ui, core | Thin adapters: parse request, call a server function, map result to response. No business logic. |

Enforced with ESLint `no-restricted-imports` overrides per folder. Extra rule: only `core/scheduler` imports `ts-fsrs`, and `core/cram.ts` and `server/study/cram.ts` never import `scheduler.review`.

This refines the spec's repository layout (section 14), which listed units directly under `src/lib/`.

## 3. Interfaces (public surface of each unit)

```ts
// core/schema
validateDeck(input: unknown): Result<Deck, ImportError[]>;
deckJsonSchema(): object;

// core/parse
parseJson(text: string): Result<Deck, ImportError[]>;
parseMarkdown(text: string): Result<Deck, ImportError[]>;
serializeJson(deck: Deck): string;
serializeMarkdown(deck: Deck): string;

// core/scheduler  (see ADR-003)
createScheduler(config: SchedulerConfig): Scheduler;

// core/typed-match
matchTyped(input: string, answer: string, accept: string[]): { correct: boolean; suggestedGrade: Grade };

// core/cram
selectCram(items: CramItem[], scope: CramScope, now: Date, rng: () => number): CramItem[];

// server/import
planImport(db: Db, deck: Deck, opts: { archiveMissing: boolean }): ImportPlan;
commitImport(db: Db, deck: Deck, opts, meta: { format: "json" | "markdown"; filename?: string }): ImportResult;

// server/study
nextItem(db: Db, scope: StudyScope, now: Date): StudyItem | { done: true; nextDueAt?: Date };
submitReview(db: Db, input: ReviewInput, now: Date): ReviewResult;
submitCram(db: Db, input: CramReviewInput, now: Date): void;

// server/stats
dashboard(db: Db, now: Date): DashboardStats;

// server/export
exportDeck(db: Db, deckId: string, format: "json" | "markdown"): string;
weakSpotReport(db: Db, scope: { deckId?: string }, now: Date): { markdown: string; json: WeakSpotReport };
backupTo(db: Db, destPath: string): Promise<void>;
```

`Result<T, E>` is a discriminated union (`{ ok: true, value } | { ok: false, error }`). Expected failures (validation, stale review, not found) are returned. Exceptions are reserved for bugs and infrastructure failure.

## 4. Data flows

### 4.1 Import

1. Route reads body (size checked), detects format from content type or file extension, calls `parseJson` or `parseMarkdown`.
2. On `ok: false`, return `422` with the error list. UI shows them with "Copy errors for Claude".
3. On `ok: true`, `planImport` returns counts and per-card diffs. `dry_run=true` stops here. The UI preview shows counts, updated-card diffs, warnings, and the `archive_missing` checkbox.
4. Commit calls `commitImport`, which recomputes the plan inside one transaction, applies it, writes `import_history`, and returns the result.

### 4.2 Study and review

1. UI requests `nextItem`. Server returns the card (type, rendered fields as raw Markdown), four grade previews, and `servedAt`.
2. Learner answers. UI sends `submitReview` with a fresh `reviewId`.
3. Server runs the transaction from ADR-003 and returns the result plus the next item, so the UI normally needs one request per card.

### 4.3 Weak-spot round trip

1. `weakSpotReport` selects up to 30 leech items (most lapses first) and the weakest 10 tags by retention, gathers their card content and the last 3 wrong typed answers per item.
2. Output is Markdown with an instruction block for Claude, the schema URL, the weak-tag table, and each card as JSON, plus the same data as JSON.
3. Claude returns a revised deck. It imports through 4.1, keeping ids and history.

## 5. Schema deltas from the spec

| Table | Change | Reason |
|---|---|---|
| `cards` | add `position` integer | Orders new cards by file order (ADR-002). |
| `card_state` | add `archived` boolean | Removed cloze ordinals leave the queue without deleting history (ADR-002). |
| `card_state` | `phase` stored as integer 0 to 3 | Maps `ts-fsrs` state, ADR-003. |
| `review_log` | pre-review snapshot stored as columns, not a JSON blob | Easier optimizer export and stats queries. |
| `settings` | seeded defaults at first boot | `target_retention` 0.9, `new_per_day` 20, `reviews_per_day` 200, `rollover_hour` 4, `leech_threshold` 8, `interleave` false |

Index additions: `card_state(card_pk)`, `card_state(due) where archived = 0`, `review_log(reviewed_at)`, `review_log(mode, reviewed_at)`.

## 6. Time model

All instants are UTC. The study day starts at `rollover_hour` in `TZ`. Day-boundary helper lives in `server/clock.ts`, uses `Intl.DateTimeFormat` with the configured zone, and is tested across DST changes. A `Clock` interface (`now(): Date`) is injected everywhere; tests use a fake clock.

## 7. Failure modes

| Failure | Effect | Handling |
|---|---|---|
| Malformed deck | Import rejected | 422 with path-level errors, nothing written |
| Crash or error mid-import | Partial data risk | Single transaction, full rollback |
| Migration fails | App cannot start | Backup copied first, process exits non-zero with a message naming the backup file |
| Disk full or volume read-only | Writes fail | Boot writability check, `/healthz` reports failure, review submission returns 503 |
| Double submit of one grade | Duplicate state change | `reviewId` idempotency |
| Two tabs grade the same item | Wrong schedule | `servedAt` stale check, 409, UI refetches |
| Card renders badly (bad Mermaid, bad cloze) | Study blocked | Raw-text fallback with error badge, the item stays gradable |
| Clock change or wrong TZ | Day boundary shifts | Study-day computation tested, TZ shown in settings |
| WAL left behind after crash | Larger file, recovered on open | SQLite recovers automatically. Docs warn against copying files while running. |
| Container killed during write | Torn write risk | WAL plus transactions, SQLite is crash-safe |

## 8. Performance budget

| Operation | Budget |
|---|---|
| Import 500-card deck (parse, plan, commit) | under 2 s end to end |
| Import 5,000-card deck | under 10 s |
| `nextItem` | under 20 ms with 20,000 items |
| `submitReview` | under 20 ms |
| Dashboard stats with 100,000 log rows | under 300 ms |
| Container start to `/healthz` OK | under 10 s |

Measured in M1 (import and queue) and M4 (stats). Indexes in section 5 serve these queries. If `nextItem` misses its budget, add a covering index before any caching.

## 9. Observability

Structured JSON logs (level via `LOG_LEVEL`) with request id, route, status, duration. `/healthz` returns `{ ok, version, dbOk }`. No metrics endpoint in v1. Import and review counts are in the database and visible in the UI.

## 10. Spec amendments recorded

1. Repository layout split into `core`, `server`, `ui` (section 2 above).
2. Image size target defined as compressed manifest size under 150 MB (ADR-004).
3. `/api/*` token protection covers all routes except `/healthz` and `/api/schema` (ADR-005).
4. Compose sample publishes on loopback by default (ADR-004, ADR-005).
5. Schema deltas in section 5.
6. Global `ssr = false` (ADR-005).

## 11. Brainy findings (competitive input)

Read from the public repository page on 2026-10-10: Brainy is a Tauri desktop application (the repo contains `src-tauri` and `vite.config.ts`), licensed AGPL-3.0, distributed through GitHub releases, Flatpak, Snap, and Nix. No Docker files. It advertises AI card generation from uploaded PDFs and notes, FSRS scheduling, and sync. **The repository is archived by its owner and read-only.** No import format is documented. Nothing in it changes this design. It strengthens the strategic case, since the closest open source competitor is desktop-only and no longer maintained. Source code internals were not inspected beyond the repository listing.
