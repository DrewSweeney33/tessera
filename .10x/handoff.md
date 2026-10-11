# Handoff

**From:** Brainstorming (all roles)
**To:** CTO and Product Manager (Phase 1) after the user approves the spec
**Date:** 2026-10-10

## Context

Tessera is a single-user, self-hosted, open source (AGPL-3.0) flashcard app. Claude generates decks in a strict JSON or Markdown format, Tessera imports them and schedules reviews with FSRS. Full design in `.10x/specs/2026-10-10-tessera-design.md`.

## Decisions already made with the user

- Single user, no login, access control by reverse proxy or VPN.
- FSRS via ts-fsrs. All four smart features: FSRS, leeches and weak spots, typed and cloze cards, cram mode and stats.
- Import: JSON canonical plus Markdown format. Paste, upload, and REST API. No MCP server in v1.
- Stack: SvelteKit (adapter-node), TypeScript, SQLite with Drizzle, Zod, one Docker container.
- Card content: Markdown, code blocks, Mermaid. No images in v1.
- License: AGPL-3.0.

## Open items for next roles

- Phase 1 should confirm the build vs buy verdict against Brainy and Anki, and record the differentiator (the Claude round trip).
- Phase 2 ADRs needed: stack and storage, deck format and idempotent import, scheduler isolation and cram mode, container base image (better-sqlite3 on arm64).
- Choice card auto-distractors deferred to v1.1.

## Environment

Windows 11, Node 24, Python 3.12, no Docker locally, git repo initialized at `C:\Dev\tessera`.
