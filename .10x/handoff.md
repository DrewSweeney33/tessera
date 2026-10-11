# Handoff

**From:** Principal Architect and Staff Engineer (Phase 2 Design)
**To:** Engineering Manager and Senior Engineer (Phase 3 Planning)
**Date:** 2026-10-10

## What was decided

Five accepted ADRs in `.10x/adrs/`:

1. **001 Stack and storage:** SvelteKit 3 and Svelte 5, TypeScript 6, `better-sqlite3` 13, Drizzle 0.45, Zod 4. Everything in one container and one SQLite file.
2. **002 Deck format and import:** JSON canonical, Markdown converts to it, one validator. Cards identified by `(deck_id, key)`. Re-import updates and keeps history, never deletes. Plan is recomputed inside the commit transaction.
3. **003 Scheduler:** `ts-fsrs` 5.x behind our own interface in `core/scheduler`. Server-authoritative queue, one item at a time. Cram writes only `review_log` and never touches `card_state`.
4. **004 Container:** `node:24-trixie-slim`, multi-stage, non-root, multi-arch to GHCR, compose publishes on loopback, compressed size target under 150 MB.
5. **005 Security:** no login, optional API token on all `/api/*` except `/healthz` and `/api/schema`, strict content types, sanitized client-side Markdown, CSP, `ssr = false`.

Architecture, module boundaries, interfaces, data flows, schema deltas, failure modes, and performance budgets are in `.10x/decisions/architect/tessera-v1.md`. Conventions, tooling, test standards, and CI are in `.10x/decisions/staff-engineer/tessera-v1.md`. The spec's section 19 lists amendments.

## For the Engineering Manager

- Break the five milestones in spec section 15 into tasks of half a day or less, sequenced by dependency. The dependency spine is: scaffold, schema, parsers, database and repos, import plan and commit, scheduler wrapper, queue and review submission, study UI, card types, Markdown format, leeches and report, cram, stats, PWA and polish, CI and release.
- Put CI and the Dockerfile early (M1), since Docker is not installable locally and CI is the only place the image is verified.
- Decide whether Mermaid lands in M1 or M2. The CSP verification item rides with it.
- Reserve a visual direction task before UI work starts, using the design skills (`impeccable` or `hallmark`).
- Keep the checkpoint after M2 explicit in the plan.
- M1 must produce a usable vertical slice: import a JSON deck, study basic cards with FSRS, run in Docker.

## For the Senior Engineer

- Spell out per-task file lists and the test to write first.
- Flag tricky parts: the Markdown state machine (fences and labels), study-day boundaries across DST, the transaction that recomputes the import plan, and the `servedAt` stale check.
- First task of M1 is scaffolding with SvelteKit 3.x. If it blocks, fall back to Kit 2.x and write a superseding ADR.

## Open items

- Mermaid and Shiki under the CSP: verify in M2.
- 5,000-card import benchmark: M1.
- Visual design direction: before UI work.
- Choice-card auto distractors: v1.1.

## Environment

Windows 11, Node 24.15.0, Python 3.12, no Docker locally, git repo at `C:\Dev\tessera`, branch `main`. Probe scripts used during Phase 2 were run in a scratch folder and are not part of the repo.
