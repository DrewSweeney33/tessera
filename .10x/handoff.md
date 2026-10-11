# Handoff

**From:** Engineering Manager and Senior Engineer (Phase 3 Planning)
**To:** SDE, with Senior Engineer review and DBA input (Phase 4 Implementation)
**Date:** 2026-10-10

## What was planned

67 tasks across five milestones, about 224 human-equivalent hours. M1 (23 tasks) and M2 (16 tasks) are fully specified with files, first tests, and watch-outs in `.10x/decisions/senior-engineer/tessera-v1.md`. M3 to M5 are outlined and get re-planned at each milestone gate. The checklist is in `.10x/status.md`. Sequencing and risks are in `.10x/decisions/engineering-manager/tessera-v1.md`.

## Start here

1. Verify an ADR exists for the work (ADRs 001 to 005 do). Do not write code without them.
2. Begin with **M1-01**: scaffold SvelteKit 3 in `C:\Dev\tessera` with the official `sv` CLI. Check the generated versions against ADR-001 (Kit 3.0.1, Svelte 5.57, Vite 8, TypeScript 6.0.x, adapter-node 6). If the scaffold is blocked, fall back to Kit 2.x and write a superseding ADR.
3. Recommended M1 order: 01, 02, 03, 04, 05, 06, 07, 08, 13, 20, 21, then 09, 10, 11, 12, 18, then 14, 15, 16, 17, 19, then 22, 23.
4. After each task: `npm run verify`, commit (Conventional Commit plus the co-author line), tick the task in `.10x/status.md`.

## Rules to keep in mind

- Layers: `core` (pure) then `server` then `ui` and `routes`. Only `core/scheduler` imports `ts-fsrs`. Cram never calls `scheduler.review`.
- Inject the clock and rng. No `Date.now()` or `Math.random()` in logic.
- SQL only in repositories. Synchronous transactions, no `await` inside.
- `{@html}` only inside `Markdown.svelte`. Sanitization tests run in a real browser.
- Never log card content, typed answers, or tokens.
- Do not add a dependency without a one-line justification and a license check.

## DBA notes for M1-05

Tables, deltas, and indexes are in the architect file sections 5. Key points: `cards.position`, `card_state.archived`, review snapshot as columns, settings seeded at first boot, `VACUUM INTO` for backups, WAL with `foreign_keys=ON`.

## Decisions needed from the owner (not blocking M1-01 to M1-12)

- GitHub remote location and visibility (blocks M1-21 running on GitHub, M2-15 publishing).
- Approval cadence for implementation.
- Visual direction input before M1-14.

## Environment

Windows 11, Node 24.15.0, Python 3.12, no Docker locally, git repo at `C:\Dev\tessera`, branch `main`, 3 commits so far (all in `.10x/`). No application code exists yet.
