# Tessera Status

**Last updated:** 2026-10-11
**Current phase:** Phase 4 Implementation, Milestone 2 in progress (started 2026-10-11). The repository is live on GitHub (public) with CI green on Linux. M2-00 to M2-15 are done and pushed (CI fully green on ad454a0, including the first image scan). No release exists; `v0.1.0` is the M2 exit.
**Feature slug:** `tessera-v1`

## Phase tracker

| Phase | State |
|---|---|
| 0 Brainstorming | Complete. Spec approved by user on 2026-10-10. |
| 1 Strategy | Complete. Verdict: build, with a checkpoint after M2. |
| 2 Design | Complete. 7 ADRs accepted (005 to 007 added during implementation). |
| 3 Planning | Complete. 67 tasks, 5 milestones, about 224 hours (human-equivalent). |
| 4 Implementation | M1 done (23 of 23 tasks), exit gate accepted by the owner 2026-10-11 ("start Milestone 2"). M2 in progress: M2-00 to M2-15 done and pushed (CI green on ad454a0). M2-16: evidence and both reports done 2026-10-11, the owner-only checks and the tag decision remain. |
| 5 Verification | **Interim pass on the M1 slice done 2026-10-11.** 2 defects fixed, 0 blocking. Repeat at the M2 exit (with a security review) and final at M5 exit. |
| 6 Delivery | **Delivery package for the M1 slice done 2026-10-11:** deploy, operations, and release docs, tag-driven release workflow, ops check script, four reliability fixes (ADR-008). Conditional sign-off: ready for the owner's own use on loopback or a VPN with backups. Public `v0.1.0` at M2 exit, `v1.0.0` at M5 exit. |

## Key artifacts

- Spec (amendments in sections 19 and 20): `.10x/specs/2026-10-10-tessera-design.md`
- CTO: `.10x/decisions/cto/tessera-v1.md`
- PM: `.10x/decisions/product-manager/tessera-v1.md`
- Architect: `.10x/decisions/architect/tessera-v1.md`
- Staff Engineer: `.10x/decisions/staff-engineer/tessera-v1.md`
- Engineering Manager (task list, sequencing, risks): `.10x/decisions/engineering-manager/tessera-v1.md`
- Senior Engineer (per-task approach): `.10x/decisions/senior-engineer/tessera-v1.md`
- SDE running log with findings per task: `.10x/decisions/sde/tessera-v1.md`
- QA: `.10x/decisions/qa/tessera-v1.md`, report `.10x/reviews/2026-10-11-qa-report.md`
- Security: `.10x/decisions/security/tessera-v1.md`, review `.10x/reviews/2026-10-11-security-review.md`
- ADRs: `.10x/adrs/001` to `008`
- DevOps: `.10x/decisions/devops/tessera-v1.md`. SRE: `.10x/decisions/sre/tessera-v1.md`
- Operator docs: `docs/deploy.md`, `docs/operations.md`, `docs/releasing.md`, `CHANGELOG.md`, `SECURITY.md`
- Docs: `README.md`, `docs/design.md`, `docs/performance.md`

## Task list

Sizes: S up to 2 hours, M up to 4 hours. Recommended M1 order is in the EM file section 9.

### M1 Vertical slice (23 of 23 done)

- [x] M1-01 Scaffold SvelteKit 3, tooling, layer lint rules (M). LICENSE added 2026-10-11: AGPL-3.0-only (the first file GitHub's picker added was the GPL v3 by mistake, replaced the same day).
- [x] M1-02 Foundations: Result, config, logger, clock, error shape (S)
- [x] M1-03 Deck schema, JSON Schema emit, schema diff check (M)
- [x] M1-04 parseJson, limits, golden fixtures (S)
- [x] M1-05 Database layer, migration 0001, pre-migration backup (M)
- [x] M1-06 Repositories (M)
- [x] M1-07 Normalize, hash, planImport (M)
- [x] M1-08 commitImport, rollback and idempotence tests (M)
- [x] M1-09 Scheduler wrapper, conformance fixtures (M)
- [x] M1-10 Study-day helper with DST tests (S)
- [x] M1-11 Queue nextItem (M)
- [x] M1-12 submitReview (M). Leech flagging landed here instead of M3-01.
- [x] M1-13 Hooks and routes: healthz, schema, import, decks, CSP (M). ADR-006 added.
- [x] M1-14 Visual direction, tokens, app shell (M). Direction "Tessera Desk", chosen by me at the owner's request. See `docs/design.md`.
- [x] M1-15 Markdown component and XSS corpus (M). Both sanitizer layers tested alone and together. Negative control done.
- [x] M1-16 Import UI (S)
- [x] M1-17 Home deck list (S)
- [x] M1-18 Study API routes (S)
- [x] M1-19 Study UI (M). All four card types render, self-graded.
- [x] M1-20 Dockerfile, compose, boot check, shutdown (M). Image built and checked in CI on amd64 and arm64 (size budget, non-root, hardened start, healthy, graceful SIGTERM, data survives a restart). Not built on this machine (no Docker). ADR-007 added.
- [x] M1-21 CI workflow with Docker smoke test (M). Run on GitHub from 2026-10-11. The first run failed on two test bugs (a race in the study layout tests, and a reduced-motion check that measured before the page was built), both fixed. Green since run #8.
- [x] M1-22 e2e (20 browser tests) and 5,000-card benchmark (M). Import 1.05 s against a 10 s budget. 52 browser tests now run green in CI. Retries are off on purpose.
- [x] M1-23 README quickstart, example deck (S)

### M1 exit gate checks (2026-10-10)

| Check | Result |
|---|---|
| `npm run verify` (types, lint, format, schema drift, tests) | Pass: 0 type errors, 309 unit and 232 integration tests |
| `npm run test:e2e` in Chrome | Pass: 20 of 20 |
| `npm run smoke` against the production build | Pass |
| `npm run benchmark` (5,000 cards) | Pass: 1.08 s import, budget 10 s |
| `npm run licenses` | Pass: 12 production packages, all allowed |
| `npm run audit:prod` | 0 vulnerabilities |
| Docker image build | Not run locally (no Docker). Built and tested by CI on amd64 and arm64, green in runs #8 and #12. |
| Contrast, both themes | 36 of 36 pairs pass AA (browser audit) |

### Phase 5 interim results (2026-10-11, commit `bb53e77`)

| Check | Result |
|---|---|
| Unit, integration, browser (Chrome) tests | 319, 232, 50 pass |
| Security probe against the built server | 101 pass, 0 fail, 1 known open gap |
| Durability and concurrency (SIGKILL, restart, parallel writes, SQLite integrity) | 54 pass |
| Accessibility (axe WCAG 2.1 A and AA), every screen state, both themes | 0 violations |
| Coverage | 92.1 percent lines, 85.3 percent branches |
| Mutation check on core invariants | 14 of 15 caught; the survivor (CSP loosening) is now covered by the probe in CI |
| Defects fixed | Q-01 no h1 on the study screen, Q-02 oversized chunked body gave 500 |
| Open security findings | S-02 token vs UI **closed by M2-12** (ADR-009, ADR-011; the token does not protect the web page, by design, and says so), S-05 image scan (Low, image is built and tested in CI, a vulnerability scan is still to add). S-01 DNS rebinding was **closed by M2-00** (2026-10-11). |
| Untested | Firefox, Safari, a real screen reader, the Docker image, CI on GitHub, Linux runs of the new scripts |

### Phase 6 delivery results (2026-10-11)

| Check | Result |
|---|---|
| Commits | `7ce8c89` delivery package and fixes, plus the state commit that follows it |
| Tests | 332 unit, 238 integration, 50 browser. Smoke 28, security probe 101 (1 known gap), durability 54, **operations check 26 (new)**, benchmark 1.09 s |
| Reliability fixes (ADR-008) | Two copies on one data folder: 60 of 60 imports now succeed (was 13 of 60). Older version refuses a newer database. Damaged database gets an actionable message. Clock stepping backwards no longer blocks a card. |
| Capacity | 313 MB under 140 requests/second for 3 minutes, flat. 5,000 cards plus 200,000 reviews: 9 to 14 ms per call, 1 s start, 0.4 s online backup, 1 s restore. |
| Release workflow | Policy-tested; shell steps run locally on 9 cases (found and fixed 2 bugs). **Rehearsed on GitHub** (manual run on a throwaway branch, since deleted): CI stage, version and changelog check, and the two-architecture build with provenance and an SBOM all passed. Not exercised, because only a tag triggers them: the registry login and push, and the GitHub Release creation. |
| Not verified | The `docker compose` wrappers in the guides, disk-full, a soak longer than 3 minutes, Firefox and Safari, a real screen reader, the registry push and release creation (first real tag) |

### GitHub setup results (2026-10-11)

| Item | Result |
|---|---|
| Repository | `DrewSweeney33/tessera`, public, `main` pushed (history includes author email `drewsweeney3@gmail.com`, accepted by the owner) |
| CI on Linux | Green: Verify (all 14 steps, including benchmark, security probe, durability, operations check) and Docker on amd64 and arm64 |
| License | `AGPL-3.0-only`, detected by GitHub as AGPL-3.0 |
| Private vulnerability reporting | Enabled |
| Dependabot | Config now holds back majors of the `node` image and `@types/node`, and updates `vitest` with `@vitest/coverage-v8` as one group. vitest 5.0.3 adopted (all tests pass). Pull request #2 (`setup-node` 7.1.0) verified, awaiting the owner's merge. |
| Release rehearsal | Passed (see above) |
| Standing approval | The owner allowed pushing CI fixes to `main` of this repository without asking each time. Everything else still needs approval. |

### M2 Card types, Markdown, Claude skill (17 tasks, about 56 hours)

- [x] M2-00 **Host check against DNS rebinding and the startup log line (security finding S-01).** Done 2026-10-11. Safe default with no configuration (localhost, IP addresses, single-word names, `.local`, `.lan`, `.home.arpa`, `.internal`, `.localdomain`). `TESSERA_ALLOWED_HOSTS` replaces the name rules and accepts `*.domain` and `name:port`. Refusal is HTTP 421 with a message that says how to fix it. `/healthz` is exempt. 87 new unit and integration tests, 40 new probe checks, 12 of 13 injected bugs caught (the 13th was a redundant condition, removed). **A real domain name, such as a reverse proxy address, now needs the setting.**
- [x] M2-01 Cloze core (S). Done 2026-10-11. Real scanner replaces the stopgap regex: nesting up to 8 deep, hints, repeated numbers, braces in ordinary text, one pass with its own stack. Reports unclosed blanks, bad numbers, empty answers, and over-deep nesting with line and column, and the deck schema refuses them with those codes.
- [x] M2-02 Cloze in import and queue, sibling burying (M). Done 2026-10-11. Add, archive, restore, and burying were already built and tested in M1. Added tests for nested blanks through the real import path (outer and inner number each get an item, progress survives nesting an existing blank), the API refusal of an unclosed blank with nothing written, and the study API serving nested items as siblings.
- [x] M2-03 Typed-answer matcher (S). Done 2026-10-11. `core/typed-match.ts`: NFKC, case fold, whitespace collapse, trailing punctuation only. `10.0.0.1` never equals `10001`. Accepted list supported. Suggests Good or Again.
- [x] M2-04 Choice validation and grading (S). Done 2026-10-11. `core/choice.ts`: grading by the author's index, and a seeded shuffle (the seed includes the review count, so a refresh keeps the order and the next review reshuffles). Schema edge cases covered. Error wording for a fractional number fixed.
- [x] M2-05 Markdown parser core (M). Done 2026-10-11. `core/parse/markdown.ts` and `markdown-syntax.ts` (line rules shared with the serializer). Front matter read with `yaml` (core schema, unique keys, alias limit 10, unknown tags refused). Cards by `## id` headings, fields by line-start labels, code fences opaque, one-backslash escape, whole-deck wrapping fence, BOM and CRLF handled. Every error has a line number.
- [x] M2-06 Markdown parser fields and inference (M). Done 2026-10-11. Type inferred from labels (Cloze, Q+Choices, Q+Answer, Q+A), `Type:` overrides, `[x]` choice marker, comma lists with `\,` escape, validator errors mapped back to lines through a source map, error list capped at 50.
- [x] M2-07 Serializers and equivalence properties (M). Done 2026-10-11. `serializeJson`, `serializeMarkdown` (reports what the Markdown format cannot hold instead of writing a lossy file). Property tests (fast-check, seeded) prove: JSON round trip exact, Markdown round trip equal after normalization, both formats parse to the same deck, writing is a fixpoint. Run with 7 other seeds at 3,000 runs each: no counterexample.
- [x] M2-08 Markdown import API and UI (S). Done 2026-10-11. `/api/import` takes `text/markdown` (client states the format, server never guesses), history records `markdown`. `core/parse/detect.ts` picks the format on the import page from the text (file name only breaks a tie). Same deck as JSON and Markdown gives identical plans and is unchanged when imported after the other. Probe gained 16 Markdown checks (alias bomb, deep nesting, tags, `__proto__`, flood, size).
- [x] M2-09 Import preview detail (M). Done 2026-10-11. The plan carries old and new text per changed field and how many review items a retype erases. Warnings: `type_changed`, `ids_changed` (a new card has exactly the content of a card missing from the file), `mostly_replaced` (half the deck missing, 3 or more new cards, and no id match). Archived cards are not counted as missing. API reply cut at 300 chars per side, diffs for the first 50 changed cards, 200 missing cards listed. The page shows a Show what changes section, a Progress starts over notice, and a Not in this file list. Preview and import give identical counts and warnings (tested). 20 injected bugs, all caught.
- [x] M2-10 Study UI for cloze, typed, choice (M). Done 2026-10-11. Typed: answer box with focus, Enter checks it (`matchTyped`), the right or wrong result and what was typed are shown, Good or Again is suggested and focused, I do not know suggests Again. Choice: options shuffled by a seed that includes the review count (stable on refresh), keys 1 to 9, right and chosen options marked with words as well as colour, explanation shown. The learner can always pick any grade, Space and Enter give the suggestion. Choice text renders without links so no control sits inside a button. The render-failure badge already existed. 11 injected bugs in the new module, all caught after one test gap was closed. Axe clean in both themes.
- [x] M2-11 Mermaid and Shiki under the CSP (M). Done 2026-10-11, **no change to the policy** (ADR-010). Shiki with its JavaScript engine (no WebAssembly), code built from text nodes. Mermaid strict, sanitized, shown as an image through a data URI, with limits, a timeout, and a source fallback. Both are dev dependencies, loaded only for cards with a code fence (plain card 194 KB of script, flowchart adds about 2.1 MB). Seven diagram types checked in a real browser. Every colour of both themes checked for contrast. 17 injected bugs, 12 caught, the rest explained in the SDE log.
- [x] M2-12 API token and allowed hosts (M). Done 2026-10-11 (allowed hosts was M2-00). With `TESSERA_API_TOKEN` set, `/api/*` (except `/api/schema`) needs `Authorization: Bearer` unless the Tessera page itself sent the request. **ADR-011 refines ADR-009:** a real browser on plain HTTP sends no `Sec-Fetch-Site`, no `Origin` on a same-origin GET, and the server believes it is https, so the page would have been locked out. The page is now recognized by `Sec-Fetch-Site`, then the Origin host and port, then a marker header that other sites cannot send. Path variants the router decodes cannot get around it. A client that copies the browser headers is accepted, which is documented and tested. 14 + 9 injected bugs, all caught. Probe has about 60 new checks, 11 new browser tests against a second server.
- [x] M2-13 Claude skill, deck-format docs, golden decks (M). Done 2026-10-11. `claude-skill/tessera-deck/SKILL.md`, `docs/deck-format.md`, `docs/claude-workflow.md`, three golden decks (CCNA in both formats, PowerShell with code, TCP/IP with diagrams), README rewritten. 34 tests keep the documents in step with the code (every example parses, languages, labels, limits, quoted error messages, error codes, links); 12 deliberate document mistakes all caught. **Found and fixed:** Prettier silently turns the lines after a choices list into part of the last choice, so an indented label is now an error (`label_in_choice`) and the writer escapes such lines; the 'Copy errors for Claude' message now asks for the deck's own format. **Not yet tried on a real Claude conversation, which needs the owner.**
- [x] M2-14 e2e for all card types and Markdown, Firefox and WebKit in CI (M). Done 2026-10-11, **and Firefox passed on its first CI run (run 38182773425)**. New keyboard-only test through import and all four card types. One browser per invocation (`E2E_BROWSER`, `scripts/run-e2e.ts`), new CI job `browsers` (Firefox and WebKit, parallel to verify, 20 minute budget). WebKit passes all 118 tests after changes that reflect real browser differences (Safari does not Tab to links by default, only Chromium can be granted clipboard access) and after removing two races in my own tests. Firefox will not launch on this Windows machine (side-by-side configuration error), so its first run was in CI, where it passed. Minimum browser versions stated in the README and deployment guide. QA risk R-1 is closed.
- [x] M2-15 Release pipeline (M). Done 2026-10-11. **Nothing published, tagged, or released.** `scripts/package-release-assets.ts` builds the deck schema, the Claude skill as a reproducible zip, and `SHA256SUMS`; `release.yml` builds them on rehearsals and tags, verifies them with `sha256sum -c` and `unzip -t`, and attaches them on a tag. The CI docker job now scans the built image with Trivy and fails on fixable high or critical findings (security finding S-05). New tests check every reference in every workflow against the repository; 12 deliberate workflow mistakes all caught. **The image scan step and the new asset step have never run on GitHub**, so the first CI run and a manual rehearsal of `release.yml` are on the first-release checklist.
- [x] M2-16 M2 exit gate (S). Done 2026-10-11: QA report and security review (`.10x/reviews/2026-10-11-qa-report-m2.md`, `…-security-review-m2.md`), then `v0.1.0` tagged and published on the owner's approval after CI was green on `ad6fb23`. Follow-up release **0.1.1** (the fixes the first real deploy and the live-image harness found, plus the harness): candidate `v0.1.1-rc.1` passed the harness on the real host (63 passed, 0 failed, 1 skipped), QA report `.10x/reviews/2026-10-12-qa-report-0.1.1.md`. The final `v0.1.1` was tagged on `c4d1f00` and published on 2026-10-12 (stable release, image tags `0.1.1`, `0.1`, and `latest`), and passed the harness on the real host again (63 passed, 0 failed, 1 skipped).

### L Library management (10 tasks, about 38 hours; added 2026-10-12 at the owner's request)

Manual deck creation, editing, practice again and start over, deck deletion (Trash), and backups from the GUI. Stories US-11 to US-16 in the PM file, delivery plan in the EM file ("Library management, added to the plan"), design in **ADR-013 and ADR-014, both Proposed and waiting for the owner**. **Started 2026-10-12.** The owner accepted ADR-013 and ADR-014 and said "next milestone", which overrides the checkpoint gate (see the CTO file). Order: L-01, L-03, L-02, L-04, L-05, L-06, L-07, L-08, L-10, then L-09.

- [x] L-01 `exportDeck` and the export route (pulled forward from M3-06) (M). Done 2026-10-12. `src/lib/server/export/` and `GET /api/decks/:id/export?format=json|md`. 34 new tests: the round trip (export, then import again, changes nothing and creates nothing) on every golden deck, both file formats, cards without ids, and generated decks (property test). 13 deliberate bugs, 12 caught, the 13th equivalent. 27 new probe checks (242 total): traversal and bad ids, bad formats, wrong methods, foreign host, token and path variants. No UI button yet (comes with the editor and the Backups page).
- [x] L-02 Create a deck by hand (M). Done 2026-10-12. `POST /api/decks`, the "New deck" page with a live id, errors beside their fields, the home page for a deck with no cards, and the shared `slugifyTitle`. The deck file format still needs one card, so a new deck is made directly (not as an empty import). Added the `conflict` error code (409). 22 slug tests (two property tests), 26 service and handler tests, 11 browser tests, accessibility and layout coverage for the page, 30 probe checks (272 in all). 13 deliberate bugs, all caught. Also fixed: export of a deck with no cards now answers 409, not a crash.
- [x] L-03 Snapshot-before-destructive-action helper (S). Done 2026-10-12. `src/lib/server/backups/`: `createSnapshot`, `withSnapshot` (no snapshot, no action, proven with an injected full disk that answers 507), `listSnapshots`, and `isSafeBackupName` (a name is never a path). 46 tests; 14 deliberate bugs, 14 caught after one test was added for the one that survived. Not wired to a route yet (L-06 to L-09 use it).
- [x] L-04 Card editor component for the four types with live preview (M). Done 2026-10-12. `src/lib/core/deck-edit.ts` (pure logic) and `CardEditor.svelte`. Card type is fixed once a card exists (changing type erases history); problems show beside fields once visited or a save is tried.
- [x] L-05 Edit a deck through the import pipeline, with the stale-write check (M). Done 2026-10-12. Server half (`GET /api/decks/:id`, `expected_revision`, 409) and the page `/decks/[id]/edit`: details, filter and show-more for big decks, add/remove/put back, review (shared `ImportPlan.svelte`, now also used by Import) then save, stale-copy notice that stays until reload, unsaved-changes guard, export buttons, Edit link on each home row. 55 unit tests (23 deliberate bugs, all caught), 28 browser tests, 2 accessibility scans in both themes, 320/375/768 layout.
- [x] L-06 Trash: delete, restore, permanent delete with typed confirmation (M). Done 2026-10-12. `src/lib/server/decks/trash.ts` (move, restore, list, delete for good with a snapshot first), four routes (`GET /api/trash`, `POST /api/decks/:id/trash|restore|delete-forever`), the `/trash` page, Move to Trash in the editor, a Trash link on the home page. 40 integration tests (15 + 12 planted bugs, all caught or equivalent), 13 browser tests plus axe scans in both themes, layout 320/375/768, and about 100 probe checks.
- [x] L-07 Start over: reset progress, keep the review log (M). Done 2026-10-12. `resetDeckProgress` (typed title, snapshot first, one transaction), `POST /api/decks/:id/start-over`, a "Start over…" panel in the editor. The first schema change since 0.1.0: migration `0001_deck_resets` adds a `deck_resets` table (one row per reset, so the schedule history can be cut at the reset). 22 integration tests (14 planted bugs, all caught), a test that upgrades a real first-release database through the real migration, 10 browser tests, axe scans, 404 probe checks in all. The live-image harness should exercise the upgrade from 0.1.1 before release (L-10).
- [ ] L-08 Backups page: back up now, list, download, delete (replaces M3-07) (M)
- [ ] L-09 Restore from the list, staged with a restart (stretch) (M)
- [ ] L-10 Probe entries, end-to-end flows, docs, skill note, harness steps (M)

### M3 Leeches, weak spots, export, settings (11 tasks, 32 hours; M3-06 and M3-07 move into L)

- [ ] M3-01 to M3-10, not started. **Held at the checkpoint gate** (the owner studies on 5 separate days with a Claude-generated deck, or overrides it). Re-plan done 2026-10-12: see the EM file, "M3 re-plan". M3-11 (competitor re-check) is done, as research, in the CTO file (it found Flash).

### M4 Cram and stats (8 tasks, 22 hours)

- [ ] M4-01 to M4-08, see EM file section 7. Re-plan at M3 exit.

### M5 PWA, polish, docs, release (9 tasks, 36 hours)

- [ ] M5-01 to M5-09, see EM file section 8. Re-plan at M4 exit.

## Backlog (not scheduled)

Added 2026-10-11 at the owner's request. Neither blocks use of 0.1.0. Both were built on 2026-10-11 and are in the release candidate `0.1.1-rc.1` (see the SDE log, "0.1.1"); they are closed when 0.1.1 is released.

- [x] **B-1 Create `/data/backups` at startup (target 0.1.1).** Found on the first homelab deploy (CT123, 2026-10-11). The folder is created only by `src/lib/server/db/migrate.ts` when a backup is taken before a database upgrade, so on a fresh install the manual backup command in `docs/operations.md` fails with `SQLITE_CANTOPEN`, and the integrity check with "directory does not exist". Chosen fix (owner, option 2): create the folder when the server starts, and fix the guide's wording. Add a test that runs the documented backup and check commands against a fresh data folder (this is what would have caught it), and cover it in `scripts/ops-check.ts` and the container job. Workaround until then: `docker compose exec tessera mkdir -p /data/backups`.
- [x] **B-2 Easy testing against the live Docker image.** `scripts/smoke.ts`, `security-probe.ts`, and `benchmark.ts` already accept `--base <url>`, but they import decks and grade cards, so they must never point at an instance that holds real study history. Idea from the owner: make it simple to check a running container on the homelab. Proposed shape: a second compose project (own port and own volume, thrown away after) on the LXC, and one documented command that runs the scripts against it. Decide how to run the scripts there (they need Node and the repository, while the LXC has only Docker) and whether to keep an AI assistant off the production LXC (it holds the real review history and the docker group is root-equivalent).

- [ ] **B-3 Oversized chunked bodies get a reset connection.** On a route with a small body limit (16 KB for create deck and study review), a chunked upload over the limit has its connection reset instead of receiving a 413. With a `Content-Length` it is a proper 413. Found by the create-deck probe. Not new (the study route behaves the same). Likely fix: read and discard the rest of the body up to a small cap before answering, or answer and close cleanly. Test with a chunked upload on every small-limit route.
- [ ] **B-4 Reorder cards in the editor.** The editor appends new cards at the end and keeps the order of the rest. Moving a card up or down (buttons, keyboard friendly) would be a small addition: card order is part of the revision, and a save sends the new order. Not asked for yet.

## Verified facts (2026-10-10)

- `ts-fsrs` 5.4.2 (MIT), FSRS-6, defaults learning steps 1m and 10m.
- `better-sqlite3` 13.0.3 bundles prebuilt binaries for linux x64 and arm64.
- `node:sqlite` rejected for v1 (release candidate, reported NUL truncation bug on Node 24.15.0).
- SvelteKit 3.0.1 needs Vite ^8.0.12, Svelte ^5.57.1, TypeScript ^6, Node >=22.17. TypeScript pinned to 6.0.x.
- Node base image `24-trixie-slim`: about 79 MB compressed, amd64 and arm64.
- Node 24's V8 omits the position for "Unexpected token" JSON errors. `parseJson` locates them itself.
- Playwright 1.64 drives the installed Chrome locally, so no browser download was needed.
- Brainy: Tauri desktop app, archived, no Docker.

## Blockers and open decisions for the owner

1. ~~M1 exit gate.~~ Accepted by the owner on 2026-10-11 when they asked to start Milestone 2.
2. **Merge Dependabot pull request #2** (`setup-node` 7.1.0). Verified safe, awaiting the owner's click.
3. **Try the guides on your own host.** Started 2026-10-11: Tessera 0.1.0 runs on the homelab (CT123, 192.168.30.102, `https://tessera.sweentech.com` through NPM); import and grading worked, and the first backup attempt found B-1 (see the backlog). The `docker compose` commands in `docs/operations.md` and `docs/deploy.md` could not be run here. Installing Docker Desktop on the dev machine would let me run them, or run the backup and restore once on the homelab and tell me anything that differs.
4. **Before the first real tag:** the repository's default workflow permission is "read repository contents and packages", which is fine because the release job asks for `packages: write` and `contents: write` itself. This can only be proven by a real tag.
5. Checkpoint gate: continue past M2 only after at least 5 distinct real study days with a Claude-generated deck.
6. Deferred to v1.1: auto-generated choice distractors, undo last grade.

Decided by the owner on 2026-10-11: the API token covers external clients only and same-origin browser requests are exempt (ADR-009, supersedes ADR-005 section 2). License `AGPL-3.0-only`. Repository public. Standing approval to push CI fixes.
