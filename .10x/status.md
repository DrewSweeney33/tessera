# Tessera Status

**Last updated:** 2026-10-10
**Current phase:** Phase 2 Design complete, ready for Phase 3 Planning
**Feature slug:** `tessera-v1`

## Phase tracker

| Phase | State |
|---|---|
| 0 Brainstorming | Complete. Spec approved by user on 2026-10-10. |
| 1 Strategy | Complete. Verdict: build, with a checkpoint after M2. |
| 2 Design | Complete. 5 ADRs accepted. Architect and Staff Engineer files written. |
| 3 Planning | Not started |
| 4 Implementation | Not started |
| 5 Verification | Not started |
| 6 Delivery | Not started |

## Key artifacts

- Spec (with Phase 2 amendments in section 19): `.10x/specs/2026-10-10-tessera-design.md`
- CTO: `.10x/decisions/cto/tessera-v1.md`
- PM: `.10x/decisions/product-manager/tessera-v1.md`
- Architect: `.10x/decisions/architect/tessera-v1.md`
- Staff Engineer: `.10x/decisions/staff-engineer/tessera-v1.md`
- ADRs: `.10x/adrs/001` to `005`

## Verified facts (2026-10-10)

- `ts-fsrs` 5.4.2 (MIT), FSRS-6, defaults learning steps 1m and 10m, API probed.
- `better-sqlite3` 13.0.3 bundles prebuilt N-API binaries for linux x64 and arm64, so no compiler in the image.
- `node:sqlite` rejected for v1: release-candidate status and a reported NUL truncation bug in Node 24.15.0.
- SvelteKit 3.0.1 requires Vite ^8.0.12, Svelte ^5.57.1, TypeScript ^6, Node >=22.17. TypeScript pinned to 6.0.x (7.0.2 is out of range).
- Node base image `24-trixie-slim`: about 79 MB compressed, amd64 and arm64.
- Brainy: Tauri desktop app, archived, no Docker.

## Blockers and notes

- Docker is not installed on the dev machine. The container build is verified in CI first.
- Checkpoint gate: continue past M2 only after at least 5 distinct real study days with a Claude-generated deck.
- Open verification items: Mermaid and Shiki under the CSP (M2), SvelteKit 3.x scaffold on day one of M1, 5,000-card import benchmark (M1).
- Deferred to v1.1: auto-generated multiple choice distractors.
