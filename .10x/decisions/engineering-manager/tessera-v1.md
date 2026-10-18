# Engineering Manager Decisions: tessera-v1

**Date:** 2026-10-10
**Phase:** 3 Planning
**Inputs:** spec (with section 19 amendments), ADRs 001 to 005, architect and staff-engineer decisions

## 1. Planning approach

- **Rolling wave.** M1 and M2 are broken into fully specified tasks now. M3, M4, and M5 are outlined at task level and get re-planned at the start of each milestone using what M1 and M2 taught us.
- **Task size.** No task exceeds half a day of human-equivalent effort. `S` is up to 2 hours, `M` is up to 4 hours. Anything that turns out larger is split before starting.
- **Estimates** are human-equivalent ideal hours and carry roughly plus or minus 30 percent. Calendar time with Claude executing tasks will differ and is not estimated here.
- **Vertical slice first.** M1 ends with a working loop: import a deck, study it with FSRS, run it in a container built by CI.

## 2. How milestones map onto the 10x phases

The 10x flow has Phase 4 (implementation), Phase 5 (verification), and Phase 6 (delivery). The project ships in five milestones, so each milestone is a small build, verify, and ship cycle.

| Milestone | Exit gate | Formal Phase 5 and 6 work |
|---|---|---|
| M1 Vertical slice | Acceptance checklist, `npm run verify` green, CI green including Docker smoke test | None. State files updated. |
| M2 Card types, Markdown, Claude skill | Checklist plus QA report and security review (token, CSP, XSS corpus, host check) | **Interim Phase 5.** Release `v0.1.0` to GHCR and run on the homelab (Phase 6 slice). Starts the owner's study checkpoint. |
| M3 Leeches, weak-spot report, export, settings | Checklist, `verify` green | State files only. |
| M4 Cram and stats | Checklist, performance budgets met | State files only. |
| M5 PWA, polish, docs, release | Checklist, accessibility audit | **Final Phase 5** (QA report, security audit) and **Phase 6** (release `v1.0.0`, SRE runbook). |

Each exit gate updates `.10x/status.md`, `.10x/handoff.md`, and the relevant `decisions/*/tessera-v1.md` files before the next milestone begins.

## 3. Planning decisions

| Decision | Choice | Reason |
|---|---|---|
| Mermaid timing | Lands in **M2**, not M1 | M1 cards are basic text and code. Mermaid also carries the CSP verification item. |
| Claude skill timing | Drafted in **M2** (spec had M3) | The checkpoint requires the owner to study a Claude-generated deck. Without the skill, deck quality is luck. M3 refines it with the weak-spot round trip. |
| Security split | CSP, content-type enforcement, request ids in **M1**. API token and host check in **M2**. | Everything is built under the CSP from day one. Token and host check matter once the app is exposed beyond loopback. |
| First release | `v0.1.0` at end of **M2** | Lets the owner deploy to the homelab and begin the 5-day study checkpoint. |
| Settings UI | **M3** | M1 and M2 run on seeded defaults. |
| Interleave setting | **M3** | Not needed for the vertical slice. |
| Charts | Hand-rolled SVG components, **no chart dependency** | Few chart types, avoids a dependency and CSP surprises. |
| PWA scope | Installable app shell only. No offline study. | Queue is server-authoritative (ADR-003), so offline study would need a different design. |
| Visual direction | A bounded task (M1-14) before UI work, then a polish pass in M5 | Keeps design from blocking logic, avoids ugly-by-default. |
| Branching | Commit per task to `main` with `verify` green until a GitHub remote exists, then short-lived branches and PRs | Single maintainer, no remote yet. |

## 4. Milestone 1: Vertical slice (23 tasks, 80 hours)

| ID | Task | Size | Depends on | Done when |
|---|---|---|---|---|
| M1-01 | Scaffold SvelteKit 3 app, TypeScript strict, ESLint, Prettier, Vitest, npm scripts, `.npmrc`, `LICENSE` (AGPL-3.0), layered import rules, `.gitignore` | M | none | `npm run verify` passes on the empty app. Layer lint rule demonstrably fails on a forbidden import. |
| M1-02 | Foundations: `Result` type, config (Zod env), logger, clock, HTTP error shape | S | 01 | Unit tests pass. Invalid env exits with a readable message. |
| M1-03 | Deck schema (Zod, four card types), `ImportError` mapping, JSON Schema emit script, CI schema diff check | M | 01, 02 | Valid and invalid examples behave per spec section 6. Emitted schema committed. |
| M1-04 | `parseJson`, size and count limits, golden fixture decks (valid and malformed with expected errors) | S | 03 | Every malformed fixture yields its expected path-level errors. |
| M1-05 | Database layer: client with pragmas, Drizzle tables with architect deltas, migration 0001, migrate on boot with pre-migration backup, `withTx`, settings seed | M | 02 | Fresh start creates the database. A second start with a changed migration copies a backup first. |
| M1-06 | Repositories: decks, cards, card_state, review_log, settings, import_history | M | 05 | Integration tests per repo on a temp SQLite file. |
| M1-07 | Normalization, content hash, `planImport` (new, unchanged, updated, type change, archive missing) | M | 03, 06 | Plan counts match every reconciliation row in ADR-002. |
| M1-08 | `commitImport` in one transaction, `import_history`, rollback test, re-import idempotence test | M | 07 | A forced failure mid-commit leaves the database unchanged. Re-import of an unchanged deck writes nothing. |
| M1-09 | Scheduler wrapper (our types, config, interval labels) and conformance fixtures from `ts-fsrs` | M | 02 | Fixture sequences match the reference library. Nothing else imports `ts-fsrs` (lint). |
| M1-10 | Study-day helper (rollover hour, TZ) with DST tests | S | 02 | Boundaries correct across both DST transitions. |
| M1-11 | `nextItem`: learning, review, new, learn-ahead, daily limits, exclusions | M | 06, 09, 10 | Ordering and limits proven with a fake clock. |
| M1-12 | `submitReview`: idempotency by `reviewId`, stale check, snapshot log, state update in one transaction | M | 11 | Double submit returns the same result. Stale submit returns 409. |
| M1-13 | `hooks.server.ts` and routes: `/healthz`, `/api/schema`, `/api/import` (JSON, `dry_run`), `/api/decks`, CSP, request id, 415 enforcement, error mapping | M | 04, 08 | Integration tests for every route and header. |
| M1-14 | Visual direction, design tokens, app shell, theme toggle (uses the design skills) | M | 01 | Shell renders in light and dark. Direction recorded in `docs/design.md`. |
| M1-15 | `Markdown.svelte` (marked, DOMPurify, link policy, no raw HTML) and XSS payload corpus tests | M | 01 | Entire corpus neutralized. Only place `{@html}` is allowed. |
| M1-16 | Import UI: paste, file drop, preview counts, error list, "Copy errors for Claude" | M | 13, 14 | Fixture deck imports from the UI. A malformed one shows path-level errors. |
| M1-17 | Home screen: deck list with due and new counts | S | 13, 14 | Counts match the database. Empty state has a clear next action. |
| M1-18 | Study API routes: next item and submit review (JSON, strict content type) | S | 12, 13 | Integration tests including stale and duplicate cases. |
| M1-19 | Study UI for basic cards: reveal, keys 1 to 4 with interval labels, focus management, session summary | M | 14, 15, 18 | A full session runs with the keyboard only. |
| M1-20 | `Dockerfile`, `.dockerignore`, `compose.yaml` (loopback, read-only root, dropped caps), writability check, graceful shutdown | M | 13 | Image definition complete. Verified in CI (task 21), since Docker is not installed locally. |
| M1-21 | CI workflow: verify, audit, license check, schema diff, Docker build, container smoke test | M | 01, 20 | Green run on GitHub, or the workflow validated locally if no remote exists yet. |
| M1-22 | Playwright happy path (import, study, grade) and a 5,000-card import benchmark script | M | 16, 19 | e2e passes. Benchmark numbers recorded against the budgets. |
| M1-23 | README quickstart and one example deck | S | 22 | A newcomer can follow it to a running instance. |

**M1 exit checklist:**

1. A JSON deck imports through both the UI and the API, and re-import is idempotent.
2. A study session completes with the keyboard only, and FSRS intervals show on the grade buttons.
3. `npm run verify` is green. XSS corpus passes. Benchmarks recorded.
4. CI builds the image and the smoke test passes (or the workflow is ready and awaiting the GitHub remote, with that stated plainly).
5. State files updated.

## 5. Milestone 2: Card types, Markdown, Claude skill (16 tasks, 54 hours)

| ID | Task | Size | Depends on | Done when |
|---|---|---|---|---|
| M2-01 | `core/cloze`: marker parsing, reveal rendering, ordinals | S | M1 | Handles nested braces, repeated numbers, missing close markers with clear errors. |
| M2-02 | Cloze in import and queue: `card_state` per ordinal, add and remove reconciliation, sibling burying | M | 01 | Ordinal changes follow ADR-002. Siblings buried until the next rollover. |
| M2-03 | Typed-answer matcher and suggested grade | S | M1 | Case, whitespace, and accept-list cases covered. |
| M2-04 | Choice card validation (exactly one correct) and grading | S | M1 | Invalid choice cards produce path-level errors. |
| M2-05 | Markdown parser core: `yaml` frontmatter, `##` card sections, field labels, fences, CRLF, line-numbered errors | M | M1 | Labels inside code fences are never parsed. |
| M2-06 | Markdown parser: type inference, `Choices:` lists, cloze and typed fields, tags and accept | M | 05 | Every spec section 6.2 example parses. |
| M2-07 | `serializeJson` and `serializeMarkdown`, equivalence and round-trip property tests | M | 06 | JSON and Markdown forms of generated decks validate identically. |
| M2-08 | Import route and UI: `text/markdown`, `.md` file drop, format autodetect | S | 06 | Both formats import from the UI and the API. |
| M2-09 | Import preview detail: updated-card diffs, type-change reset warnings, mass id-change heuristic, missing cards, `archive_missing` checkbox | M | M1 | Preview matches the plan exactly. |
| M2-10 | Study UI for cloze, typed, and choice, with the render-failure fallback badge | M | 02, 03, 04 | All four card types study end to end. |
| M2-11 | Mermaid and Shiki lazy loading under the CSP, with a documented fallback | M | M1 | Works under the policy or the narrowest relaxation is recorded in an ADR addendum. |
| M2-12 | Security hardening: `TESSERA_API_TOKEN` enforcement, `TESSERA_ALLOWED_HOSTS`, boot warnings | M | M1 | Tests for missing, wrong, and right tokens and for host mismatch. |
| M2-13 | Claude skill `tessera-deck`, `docs/deck-format.md`, `docs/claude-workflow.md`, three realistic golden decks (including a CCNA sample) | M | 07 | Golden decks import cleanly. Skill reviewed against the schema. |
| M2-14 | Playwright coverage for all card types and Markdown import, keyboard-only run | M | 10, 08 | Passes in CI. |
| M2-15 | `release.yml`: multi-arch build, GHCR push, schema and skill attached as release assets. **Publishing needs the owner's approval.** | M | M1 | Workflow validated. Publication happens only after approval. |
| M2-16 | M2 exit gate: QA report, security review, `v0.1.0` | S | all | Reports written, tag created after approval. |

**M2 exit checklist:** all four card types study correctly, both formats import with identical results, Mermaid and Shiki run (or the documented relaxation is in place), token and host protections are tested, the skill and three golden decks exist, a QA report and security review are written, and `v0.1.0` is ready to deploy.

## 6. Milestone 3 outline: Leeches, weak spots, export, settings (11 tasks, 32 hours)

| ID | Task | Size |
|---|---|---|
| M3-01 | Leech flag in `submitReview`, leech repo queries, threshold setting | S |
| M3-02 | Leech list UI with suspend, reset, copy rewrite request | M |
| M3-03 | Weak-tag computation (retention and lapse rate per tag) | S |
| M3-04 | `weakSpotReport` Markdown and JSON, recent wrong typed answers, caps | M |
| M3-05 | `/api/report/weak-spots` and UI button with copy | S |
| M3-06 | `exportDeck` in both formats, `/api/decks/:id/export`, round-trip test | M |
| M3-07 | `/api/backup` with `VACUUM INTO`, UI link, restore documentation, test | S |
| M3-08 | Skill update for the round trip, example report and revised deck fixture, e2e of the full loop | M |
| M3-09 | Settings UI: limits, target retention, rollover hour, leech threshold, TZ display | M |
| M3-10 | Interleave option in the queue | S |
| M3-11 | Competitor re-check (Brainy status, Anki changes) and update of the CTO file | S |

## 7. Milestone 4 outline: Cram and stats (8 tasks, 22 hours)

| ID | Task | Size |
|---|---|---|
| M4-01 | `core/cram` selection (all, tag, weakest) with injected rng | S |
| M4-02 | `submitCram` and the invariance test (card state unchanged) | S |
| M4-03 | Cram UI: setup with exam date, session, summary | M |
| M4-04 | Stats queries: today, true retention, 30-day forecast, streak and heatmap, per-tag, state counts | M |
| M4-05 | Stats indexes and 100,000-row benchmark | S |
| M4-06 | Dashboard UI with hand-rolled SVG charts | M |
| M4-07 | Deck exam date: setting, countdown, cram suggestion | S |
| M4-08 | e2e for cram and stats | S |

## 8. Milestone 5 outline: PWA, polish, docs, release (9 tasks, 36 hours)

| ID | Task | Size |
|---|---|---|
| M5-01 | PWA manifest, icons, app-shell service worker | M |
| M5-02 | Visual polish pass, part 1 (design audit and fixes) | M |
| M5-03 | Visual polish pass, part 2 (motion, empty states, error states) | M |
| M5-04 | Accessibility audit: axe in Playwright, keyboard-only run, contrast, zoom | M |
| M5-05 | Responsive and phone pass | M |
| M5-06 | Docs part 1: README, quickstart, deck format, Claude workflow | M |
| M5-07 | Docs part 2: security, backup, API, CONTRIBUTING, troubleshooting | M |
| M5-08 | Final QA report and security audit (Phase 5) | M |
| M5-09 | Delivery: SRE runbook, `v1.0.0` release, image size record (Phase 6) | M |

## 9. Sequencing

Dependency spine for M1, with three branches that can proceed in any order once their root is done:

```
01 scaffold
 +-- 02 foundations
 |    +-- 03 schema -- 04 parseJson ----------------------+
 |    +-- 05 database -- 06 repos -- 07 plan -- 08 commit -+-- 13 routes -- 16 import UI
 |    +-- 09 scheduler --+                                      |        \-- 17 home
 |    +-- 10 study day --+-- 11 queue -- 12 submit -- 18 study routes -- 19 study UI
 +-- 14 visual direction ----------------------------------------------^
 +-- 15 Markdown component --------------------------------------------^
 13 -- 20 Dockerfile -- 21 CI;   16 + 19 -- 22 e2e + benchmark -- 23 docs
```

**Recommended execution order for a single executor:**

01, 02, 03, 04, 05, 06, 07, 08, 13, 20, 21 (backend, container, and CI first, so the image is verified early), then 09, 10, 11, 12, 18, then 14, 15, 16, 17, 19, then 22 and 23.

Rationale: CI and the Dockerfile are early because Docker cannot be tested locally and the pipeline is the only verifier. The visual direction task is late enough that the study logic exists and early enough that no UI is built without it.

## 10. Estimates

| Milestone | Tasks | Hours | Human-equivalent days |
|---|---|---|---|
| M1 | 23 | 80 | 10 |
| M2 | 16 | 54 | 7 |
| M3 | 11 | 32 | 4 |
| M4 | 8 | 22 | 3 |
| M5 | 9 | 36 | 4.5 |
| **Total** | **67** | **224** | **28.5** |

Hours are computed from the task sizes (S = 2 hours, M = 4 hours).

Confidence plus or minus 30 percent. M1 is the riskiest estimate because it includes the SvelteKit 3.x scaffold, the Docker pipeline, and the first use of every library.

## 11. Risks and contingency

| Risk | Likelihood | Impact | Mitigation or contingency |
|---|---|---|---|
| SvelteKit 3.x scaffold blocked or unstable | Medium | High | M1-01 is first. Fall back to Kit 2.x with a superseding ADR, one day of slack. |
| Docker image fails only in CI | Medium | Medium | CI is built in M1. The owner can also test on a homelab host. Fix cycles are fast with the smoke test. |
| Markdown parser edge cases | Medium | Medium | Property tests (M2-07), golden fixtures, line-numbered errors, and a rule that JSON is the fallback format. |
| Mermaid or Shiki incompatible with the CSP | Medium | Low | M2-11 timeboxed to one half day, then relax narrowly and document. |
| `ts-fsrs` mapping bug | Low | High | Conformance fixtures in M1-09 and the review snapshot in the log. |
| Scope creep (accounts, media, auto distractors) | Medium | High | Non-goals list in the spec. New work waits for a milestone re-plan. |
| UI polish absorbs the schedule | Medium | Medium | Interaction model first, polish bounded to M5-02 and M5-03. |
| Checkpoint fails (owner does not study with it) | Unknown | Strategic | Planned decision point after M2, not a surprise. |

## 12. Decisions that need the owner

1. **GitHub remote.** Where should the repository live (account or organization, public from day one or private until M2)? Publishing code and images is outward-facing, so nothing is pushed without approval.
2. **Docker locally.** Optional: installing Docker Desktop would let local builds be tested before CI. Without it, CI is the only image verification.
3. **Approval cadence during implementation.** Confirm after every task, after every milestone, or only at milestone exit gates? Recommendation: confirm at milestone exit gates, with a short report per task.
4. **Visual direction input.** Any existing tastes (a reference app, a color preference, dark-first or light-first)? Otherwise the design task picks a direction and shows it for approval.

## 13. Working agreements

- **Definition of Ready:** task has a done-when line, listed dependencies are complete, and the first test is known.
- **Definition of Done:** `npm run verify` passes, new behavior has tests, docs updated for user-visible changes, commit made with a Conventional Commit message ending with the co-author line, and `.10x/status.md` updated at milestone gates.
- **Splitting rule:** a task that exceeds its size is split before continuing, not stretched.
- **State discipline:** the milestone exit gate writes decisions, status, and handoff files before the next milestone starts.
- **Going back is allowed:** a design flaw found during a task returns to the Architect role, with an ADR addendum or a superseding ADR.

## M3 re-plan (2026-10-12)

The status file asked for a re-plan at the M2 exit. This is it. **Nothing here is started.** The CTO's continue criterion says to go past M2 only after the owner has studied for real on at least 5 separate days with a Claude-generated deck, and Tessera went live on the homelab on 2026-10-11. So M3 waits for the owner to say the checkpoint is met (or to override it).

### What changed since the outline

1. **M3-11 (competitor re-check) is done**, as research, in the CTO file. It found Flash, a self-hosted FSRS app that Claude drives over MCP, and it makes M3-04 and M3-05 (the weak-spot round trip) the clearest differentiator.
2. **The definition of done grew.** Every new route gets entries in the security probe and in `probe:remote-check`'s coverage (the hardening checklist from the security review). Every release gets a live-image harness run recorded in its QA report (ADR-012). Troubleshooting rows go in the operations guide for any new error.
3. **The error shape has two new codes:** `storage_full` (507) and `service_unavailable` (503) for a full or unwritable data folder. Any M3 route that writes (settings, leech actions, restores) must go through `toErrorResponse` so it answers the same way.
4. **The backups folder now exists on a fresh install.** M3-07 builds on that.
5. **Real-host numbers exist** for a budget: reads about 22 ms and writes about 21 ms at the median over the network, memory about 80 MiB under load, a 5,000 card import in about 2 seconds.

### Order, with a done-when line per task (each test-first)

| Order | Task | Done when |
|---|---|---|
| 1 | M3-01 leech repo queries, and confirming the flag | **The flag itself already exists** (built in M1-12: `submitReview` flags an item when its lapses reach `settings.leechThreshold`, default 8, validated as 2 to 100, and never suspends it). Remaining: a leech query in the repos (list, count, per deck), tests that the flag fires exactly once and not on a replay of the same review, and that changing the threshold changes the next flag. This task is smaller than the outline says, about 2 hours. |
| 2 | M3-02 leech list UI: suspend, reset, copy rewrite request | The list shows the full card, lapse count, and wrong typed answers. Suspend removes the item from the queue until it is unsuspended. Reset clears lapses and the flag, and keeps history. The copied request names the deck, the card id, and the format to return. Keyboard-only and axe tests pass. |
| 3 | M3-03 weak-tag computation | Per-tag retention and lapse rate from the review log, with a minimum count so a tag with 2 reviews is not "weak". Tested against a hand-computed fixture. |
| 4 | M3-04 `weakSpotReport` in Markdown and JSON | Contains leech cards with full content, lapse counts, recent wrong typed answers, and the weakest tags, within a stated size cap (so it still fits in a prompt), with a note when it was cut. The JSON and Markdown forms carry the same facts (property test). |
| 5 | M3-05 `/api/report/weak-spots` and the UI button with copy | Same report over HTTP and in the page. Added to the probe. The copied text is a paste-ready prompt that asks for a revised deck in the Tessera format. |
| 6 | M3-06 `exportDeck` in both formats and `/api/decks/:id/export` | Round trip: export, import, and compare gives no changes and no new cards, for every golden deck and for generated decks (property test). Ids stay stable. A card type change is not introduced by export. |
| 7 | M3-07 `/api/backup` and a UI link, restore documentation | Uses `VACUUM INTO`, writes the snapshot into the data folder's `backups` folder (not `/tmp`, which is memory-backed and counts against the 512 MB limit), streams it, and removes it afterwards. A full disk answers 507. The restore guide is tested with the live-image harness. With the API token set, a non-page caller needs the token. |
| 8 | M3-08 skill update for the round trip, an example report, a revised deck fixture, and an end-to-end test of the full loop | The Claude skill explains the weak-spot loop. The e2e test imports a deck, makes a card a leech, copies the report, imports a revised deck by the same ids, and the leech history is kept as the plan for re-import says. |
| 9 | M3-09 settings UI: limits, target retention, rollover hour, leech threshold, time zone display | Each setting is validated on the server and in the form, with limits. A bad value is a 422 with the field named. Changing the rollover hour or target retention is explained (what it affects). Added to the probe. |
| 10 | M3-10 interleave option in the queue | Off by default. When on, new and review items are mixed in a stated ratio, and cloze siblings stay buried. Property test on the queue. |
| done | M3-11 competitor re-check | See the CTO file. |

Estimate: 10 tasks left, about 30 hours of the original 32, unchanged.

### Risks specific to M3

| Risk | Mitigation |
|---|---|
| The weak-spot report is too big for a prompt | A cap per section and a "truncated" note, tested at the cap |
| Export is not an exact inverse of import (Markdown formatting differences) | The round-trip property test comes first. Where JSON and Markdown differ, JSON is the reference. |
| `/api/backup` exposes the whole database to anything that can reach it | It follows the existing rules: the host check, and the token for callers that are not the page. State this in the security review at the M3 exit. The documentation says plainly that the page has no login. |
| A large backup response uses memory | Stream from the file. Test with a 55 MB database against the 512 MB limit on the real host with the harness. |
| Scope creep (MCP, accounts, `.apkg` import) | Out of scope until a milestone re-plan. Flash does `.apkg` and MCP, so the owner may raise them at the checkpoint. |

### Gate and start condition

Start only when the owner says the checkpoint is met or overrides it. Then: write the design notes and ADRs that M3 needs (the report contract and the export and backup endpoints), update `status.md` to Phase 4 for M3, and begin at M3-01. At the M3 exit: QA and security reports, a harness run, and a release, only on the owner's approval. The plan names only `v0.1.0` (M2) and `v1.0.0` (M5), so the M3 version number is for the owner to choose. Semantic versioning would make it `0.2.0`, since it adds features.

## Library management, added to the plan (2026-10-12)

The owner asked for manual deck creation, editing, practice again and start over, deck deletion, and backups from the GUI (PM file, US-11 to US-16). Designs are in ADR-013 and ADR-014, both **Proposed** for the owner's review. **Nothing is started.** This section is the plan, and it keeps the checkpoint gate: the work starts when the owner says so.

### Tasks (new milestone "L", each test-first)

| ID | Task | Size | Depends on | Done when |
|---|---|---|---|---|
| L-01 | Pull M3-06 forward: `exportDeck` in both formats and `/api/decks/:id/export` | M | none | The round-trip property test passes (export then import changes nothing) for every golden deck. The editor depends on it. |
| L-02 | Create a deck: allow an empty deck in the planner, a create route, a "New deck" form with the id slug (unique, editable until saved) | M | none | US-11. The slug helper and the uniqueness message are unit tested. A created deck appears on the home page. |
| L-03 | Snapshot-before-destructive-action helper: names by kind, the disk-full guard, the `backups` listing | S | none | A destructive action does not run if the snapshot cannot be written (a 507 test). Names cannot collide. |
| L-04 | Card editor component for the four types, with a live preview and the same validation messages as import | M | L-01 | Every field error names the field. An invalid card cannot be saved. Keyboard-only and axe tests pass. |
| L-05 | Edit a deck: load through export, save through the import pipeline, add, edit, and archive cards, edit title, description, and tags, with the stale-write check (`updatedAt`) | M | L-01, L-04 | US-12. Progress is kept for edited text, a type change warns, a stale save is refused with a clear message. The write goes through the existing planner (no second write path). |
| L-06 | Trash: delete (archive) a deck, hide it everywhere including the queue, restore, permanent delete with the title typed and a snapshot first | M | L-03 | US-14. A permanent delete removes cards, state, and history, and a restore from Trash loses nothing. A test proves an archived deck is absent from every list and from `/api/study/next`. |
| L-07 | Start over: reset a deck's card state, keep the review log, typed confirmation, snapshot first | M | L-03 | US-13 (start over). Property test: after a reset every card is new and the log row count is unchanged. |
| L-08 | Backups page: back up now, list, download, delete, with the same-disk warning (this replaces M3-07's single endpoint) | M | L-03 | US-15. Names are never paths (traversal tests). A full disk answers 507. A download streams without growing memory (measured on the real host with a 55 MB database). |
| L-09 | Restore from the list, staged with a restart (ADR-014): checks, a `pre-restore` snapshot, the marker file, the swap at start | M | L-08 | US-16 (stretch). A crash test: a kill between the marker and the swap leaves the old data or the new, never a mix. The live-image harness restores on the real host and watches Docker restart the server. |
| L-10 | Probe entries for every new route, end-to-end tests of each flow (create, edit, delete and restore, start over, back up), docs, and the skill's note that hand edits exist | M | L-02 to L-08 | All flows pass on three browser engines. The probe has traversal, method, token, and host cases for the new routes. The harness gains download and restore steps. |

**Also in the plan, not new:** "Practice again" is the cram mode already planned for M4 (US-7). If the owner wants it sooner, it moves up, because it is independent of these tasks.

### Estimate

L-01 to L-10 add up to about 38 hours, with L-01 taken from M3 (M3-06) and L-08 replacing M3-07, so the net addition to the whole plan is about 32 hours. Confidence plus or minus 30 percent, as for the rest.

### Order, recommended

L-01, L-03, L-02, L-04, L-05, L-06, L-07, L-08, L-10, then L-09 if the owner wants restore in the GUI. After that, the original M3 (leeches and weak spots), then M4, then M5. **Why before the weak-spot work:** the owner needs to manage decks by hand to use Tessera every day, which is also what the checkpoint measures. The alternative order (weak spots first) is valid if the owner prefers it. Either way each group ships as its own release candidate, with a harness run on the real host recorded in its QA report (ADR-012). A version number for each is the owner's choice. Semantic versioning would make library management `0.2.0`.

### Risks specific to this group

| Risk | Mitigation |
|---|---|
| A hand edit is overwritten by a later re-import of an older Claude deck | The preview shows the overwrite and the owner decides. Documented. No locking feature in the first cut. |
| A destructive action destroys history by mistake | Trash first, archive by default, a typed confirmation, and a snapshot before it runs. Nothing runs if the snapshot fails. |
| The editor grows into a large piece of UI | Four card types and live preview only. No images, no rich-text toolbar, no drag-and-drop reorder in the first cut. |
| A new write surface on an unauthenticated page | The existing guards, probe entries for every new route, and a security review at the exit |
| Restore corrupts data | Staged restart (not a hot swap), a `pre-restore` snapshot, `tessera.db.before-restore`, and a crash test |
| The owner's other, not yet stated, requests | The PM file lists candidates. Each new request gets a story, a place in this order, and a size before it is built. |

## M4 re-plan (2026-10-17)

Done at the start of Milestone 4, after the owner's "Start Milestone 4". Replaces the outline in section 7 (M4-01 to M4-08, 22 hours). Reason: folder statistics (ADR-016) already compute most of the statistics tasks, and the owner's choices narrowed practice to a deck or a folder. About 16 hours in the plan's units. Spec: `.10x/specs/2026-10-17-milestone-4-practice-and-stats-design.md`.

| ID | Task | Size |
|---|---|---|
| M4-01 | `core/practice.ts` (queue with loop-back, summary), `server/practice/select.ts` (pool, shuffled and weakest-first order, count); tests | M |
| M4-02 | `POST /api/practice/start`, `GET /api/practice/item`, `POST /api/practice/grade`; invariance test, lint rule, planted bugs, probe entries | M |
| M4-03 | `/practice` page (setup, session, summary, resume), entry points on deck tiles and folders, keys | M |
| M4-04 | Slice A e2e, accessibility, docs, vault notes, deploy | S |
| M4-05 | Statistics by scope, `GET /api/stats`, forecast, heatmap, per-tag retention, practiced today; tests | M |
| M4-06 | `/stats` page, scope picker, SVG charts, nav entry | M |
| M4-07 | Migration `0003_folder_exam_date`, exam date on folders (validation, API, countdown, suggestion, restore test) | S |
| M4-08 | 100,000-row benchmark and indexes, slice B e2e, accessibility, docs, vault notes, deploy | S |

**Order:** slice A (M4-01 to M4-04, no migration), deploy; slice B (M4-05 to M4-08), harness with `--expect-migration`, deploy. Owner's standing rules apply: backup first, commit and push only on request.
