# Tessera Status

**Last updated:** 2026-10-10
**Current phase:** Phase 3 Planning complete, ready for Phase 4 Implementation
**Feature slug:** `tessera-v1`

## Phase tracker

| Phase | State |
|---|---|
| 0 Brainstorming | Complete. Spec approved by user on 2026-10-10. |
| 1 Strategy | Complete. Verdict: build, with a checkpoint after M2. |
| 2 Design | Complete. 5 ADRs accepted. |
| 3 Planning | Complete. 67 tasks, 5 milestones, about 224 hours (human-equivalent). |
| 4 Implementation | Not started. Runs milestone by milestone (M1 to M5), each with an exit gate. |
| 5 Verification | Interim at M2 exit, final at M5 exit |
| 6 Delivery | `v0.1.0` at M2 exit, `v1.0.0` at M5 exit |

## Key artifacts

- Spec (amendments in sections 19 and 20): `.10x/specs/2026-10-10-tessera-design.md`
- CTO: `.10x/decisions/cto/tessera-v1.md`
- PM: `.10x/decisions/product-manager/tessera-v1.md`
- Architect: `.10x/decisions/architect/tessera-v1.md`
- Staff Engineer: `.10x/decisions/staff-engineer/tessera-v1.md`
- Engineering Manager (task list, sequencing, risks): `.10x/decisions/engineering-manager/tessera-v1.md`
- Senior Engineer (per-task approach): `.10x/decisions/senior-engineer/tessera-v1.md`
- ADRs: `.10x/adrs/001` to `005`

## Task list

Sizes: S up to 2 hours, M up to 4 hours. Recommended M1 order is in the EM file section 9.

### M1 Vertical slice (23 tasks, 80 hours)

- [x] M1-01 Scaffold SvelteKit 3, tooling, layer lint rules (M). LICENSE file pending owner permission to download the AGPL-3.0 text.
- [x] M1-02 Foundations: Result, config, logger, clock, error shape (S)
- [x] M1-03 Deck schema, JSON Schema emit, schema diff check (M)
- [x] M1-04 parseJson, limits, golden fixtures (S)
- [x] M1-05 Database layer, migration 0001, pre-migration backup (M)
- [x] M1-06 Repositories (M)
- [x] M1-07 Normalize, hash, planImport (M)
- [x] M1-08 commitImport, rollback and idempotence tests (M)
- [ ] M1-09 Scheduler wrapper, conformance fixtures (M)
- [ ] M1-10 Study-day helper with DST tests (S)
- [ ] M1-11 Queue nextItem (M)
- [ ] M1-12 submitReview (M)
- [x] M1-13 Hooks and routes: healthz, schema, import, decks, CSP (M). ADR-006 added.
- [ ] M1-14 Visual direction, tokens, app shell (M)
- [ ] M1-15 Markdown component and XSS corpus (M)
- [ ] M1-16 Import UI (M)
- [ ] M1-17 Home deck list (S)
- [ ] M1-18 Study API routes (S)
- [ ] M1-19 Study UI for basic cards (M)
- [ ] M1-20 Dockerfile, compose, boot check, shutdown (M)
- [ ] M1-21 CI workflow with Docker smoke test (M)
- [ ] M1-22 e2e happy path and 5,000-card benchmark (M)
- [ ] M1-23 README quickstart, example deck (S)

### M2 Card types, Markdown, Claude skill (16 tasks, 54 hours)

- [ ] M2-01 Cloze core (S)
- [ ] M2-02 Cloze in import and queue, sibling burying (M)
- [ ] M2-03 Typed-answer matcher (S)
- [ ] M2-04 Choice validation and grading (S)
- [ ] M2-05 Markdown parser core (M)
- [ ] M2-06 Markdown parser fields and inference (M)
- [ ] M2-07 Serializers and equivalence properties (M)
- [ ] M2-08 Markdown import API and UI (S)
- [ ] M2-09 Import preview detail (M)
- [ ] M2-10 Study UI for cloze, typed, choice (M)
- [ ] M2-11 Mermaid and Shiki under the CSP (M)
- [ ] M2-12 API token and allowed hosts (M)
- [ ] M2-13 Claude skill, deck-format docs, golden decks (M)
- [ ] M2-14 e2e for all card types and Markdown (M)
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
- Brainy: Tauri desktop app, archived, no Docker.

## Blockers and open decisions for the owner

- No GitHub remote exists. Where should the repo live and when does it go public? Nothing is pushed or published without approval.
- Approval cadence during implementation: recommendation is confirm at milestone exit gates with a short report per task.
- Visual direction preferences (reference apps, dark or light first) are optional input for M1-14.
- Docker Desktop is optional on the dev machine. Without it, CI is the only image verification.
- Checkpoint gate: continue past M2 only after at least 5 distinct real study days with a Claude-generated deck.
- Deferred to v1.1: auto-generated choice distractors, undo last grade.
