# Handoff

**From:** CTO and Product Manager (Phase 1 Strategy)
**To:** Principal Architect and Staff Engineer (Phase 2 Design)
**Date:** 2026-10-10

## What was decided

- **Build**, not buy. Differentiator is the Claude round trip: strict versioned deck schema with Claude-fixable errors, idempotent re-import preserving history, weak-spot report back to Claude, zero-install web UI. Honest caveat: Anki plus an `.apkg` generator approximates this.
- Checkpoint after M2: continue only after 5 real study days. Otherwise switch to Anki plus a generator skill.
- Stack confirmed. `ts-fsrs` pinned to 5.x (latest 5.4.2, MIT). Do not adopt the 6.0 beta. `better-sqlite3` 13.0.3 (MIT). SvelteKit version to be re-verified.
- Scope: must have US-1 to US-5, US-9, US-10. Should have US-6, US-7, US-8. Out: accounts, media, MCP, auto distractors, native apps.

## Requirements for the architect

- ADRs required before any code (see below). Each needs at least one real alternative.
- Read Brainy's source (`brainylearn/brainy-app`) and record anything that changes the design.
- Keep `scheduler` isolated behind our interface with conformance fixtures.
- Single-user schema, no user_id columns.

## ADRs to write in Phase 2

1. Stack and storage: SvelteKit adapter-node, SQLite with `better-sqlite3`, Drizzle.
2. Deck format and idempotent import: JSON canonical, Markdown converts to JSON, stable card ids, content hash, no silent deletion.
3. Scheduler isolation and cram mode: wrapper around `ts-fsrs`, cram never writes FSRS state, `review_log` keeps pre-review snapshots.
4. Container and base image: Node 24 LTS on a Debian-based image, `better-sqlite3` on amd64 and arm64, non-root.
5. Security posture without login: optional API token, CSP, sanitized Markdown, Mermaid strict.

## Open questions

- Mermaid in M1 or M2 (EM decides in Phase 3).
- UI visual direction (decide at implementation with the design skills, for example `impeccable` or `hallmark`).

## Environment

Windows 11, Node 24, Python 3.12, no Docker locally, git repo at `C:\Dev\tessera`, branch `main`.
