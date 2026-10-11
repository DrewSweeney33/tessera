# Tessera Status

**Last updated:** 2026-10-11
**Current phase:** Phase 5 Verification (interim, M1 slice) complete. Milestone 1 awaits the owner's exit-gate confirmation.
**Feature slug:** `tessera-v1`

## Phase tracker

| Phase | State |
|---|---|
| 0 Brainstorming | Complete. Spec approved by user on 2026-10-10. |
| 1 Strategy | Complete. Verdict: build, with a checkpoint after M2. |
| 2 Design | Complete. 7 ADRs accepted (005 to 007 added during implementation). |
| 3 Planning | Complete. 67 tasks, 5 milestones, about 224 hours (human-equivalent). |
| 4 Implementation | M1 done (23 of 23 tasks). Waiting for the owner to confirm the M1 exit gate before M2 starts. |
| 5 Verification | **Interim pass on the M1 slice done 2026-10-11.** 2 defects fixed, 0 blocking. Repeat at the M2 exit (with a security review) and final at M5 exit. |
| 6 Delivery | `v0.1.0` at M2 exit, `v1.0.0` at M5 exit |

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
- ADRs: `.10x/adrs/001` to `007`
- Docs: `README.md`, `docs/design.md`, `docs/performance.md`

## Task list

Sizes: S up to 2 hours, M up to 4 hours. Recommended M1 order is in the EM file section 9.

### M1 Vertical slice (23 of 23 done)

- [x] M1-01 Scaffold SvelteKit 3, tooling, layer lint rules (M). LICENSE file pending owner permission to download the AGPL-3.0 text.
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
- [x] M1-20 Dockerfile, compose, boot check, shutdown (M). Image not built locally (no Docker), runtime stage simulated. ADR-007 added.
- [x] M1-21 CI workflow with Docker smoke test (M). Not yet run on GitHub (no remote).
- [x] M1-22 e2e (20 browser tests) and 5,000-card benchmark (M). Import 1.05 s against a 10 s budget. CI e2e job not yet run on GitHub.
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
| Docker image build | Not run (no Docker locally). Verified by CI only, and CI has never run. |
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
| Open security findings | S-01 DNS rebinding (Medium), S-02 token vs UI (Medium), S-05 image never built (Low) |
| Untested | Firefox, Safari, a real screen reader, the Docker image, CI on GitHub, Linux runs of the new scripts |

### M2 Card types, Markdown, Claude skill (17 tasks, about 56 hours)

- [ ] M2-00 **Host check against DNS rebinding and the startup warning (security finding S-01).** Do this first. Safe default with no configuration, `TESSERA_ALLOWED_HOSTS` to override. The probe check flips from KNOWN to PASS. (S)
- [ ] M2-01 Cloze core (S). Note: an interim `clozeSides` already exists in `core/cloze.ts` for the study UI.
- [ ] M2-02 Cloze in import and queue, sibling burying (M). Burying is already in `submitReview`.
- [ ] M2-03 Typed-answer matcher (S)
- [ ] M2-04 Choice validation and grading (S)
- [ ] M2-05 Markdown parser core (M)
- [ ] M2-06 Markdown parser fields and inference (M)
- [ ] M2-07 Serializers and equivalence properties (M)
- [ ] M2-08 Markdown import API and UI (S)
- [ ] M2-09 Import preview detail (M)
- [ ] M2-10 Study UI for cloze, typed, choice (M)
- [ ] M2-11 Mermaid and Shiki under the CSP (M)
- [ ] M2-12 API token and allowed hosts (M). **Needs the S-02 design decision first, and M2-00 done.** Allowed hosts moves to M2-00.
- [ ] M2-13 Claude skill, deck-format docs, golden decks (M)
- [ ] M2-14 e2e for all card types and Markdown (M). Add Firefox and WebKit projects to CI (QA risk R-1).
- [ ] M2-15 Release pipeline, publication needs owner approval (M)
- [ ] M2-16 M2 exit gate: QA report, security review, v0.1.0 (S)

### M3 Leeches, weak spots, export, settings (11 tasks, 32 hours)

- [ ] M3-01 to M3-11, see EM file section 6. Re-plan at M2 exit.

### M4 Cram and stats (8 tasks, 22 hours)

- [ ] M4-01 to M4-08, see EM file section 7. Re-plan at M3 exit.

### M5 PWA, polish, docs, release (9 tasks, 36 hours)

- [ ] M5-01 to M5-09, see EM file section 8. Re-plan at M4 exit.

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

1. **M1 exit gate.** Confirm M1 so M2 can start, or ask for changes. QA conditions: first green CI run on GitHub (needs item 4), and M2-00 scheduled first.
2. **API token versus the browser UI (blocks M2-12; security finding S-02).** ADR-005 requires the bearer token on every `/api/*` route except `/healthz` and `/api/schema`, but the browser UI calls those routes without a token, so enabling it would lock the UI out. Recommendation: the token covers only external clients, same-origin browser requests (`Sec-Fetch-Site: same-origin`) are exempt, and this ships only after M2-00 because a DNS-rebound page also looks same-origin. Needs your decision, then an ADR-005 amendment.
3. **LICENSE file.** Permission to download the AGPL-3.0 text from gnu.org, and `AGPL-3.0-only` or `AGPL-3.0-or-later`.
4. **GitHub remote.** Where should the repo live and when does it go public? Nothing is pushed or published without approval. CI has never run, so the Docker image and the CI e2e job are unverified until it does.
5. Docker Desktop is optional on the dev machine. Without it, CI is the only image verification.
6. Checkpoint gate: continue past M2 only after at least 5 distinct real study days with a Claude-generated deck.
7. Deferred to v1.1: auto-generated choice distractors, undo last grade.
