# Product Manager Decisions: tessera-v1

**Date:** 2026-10-10
**Phase:** 1 Strategy
**Spec:** `.10x/specs/2026-10-10-tessera-design.md`

## Problem statement

People who learn with an AI tutor get lessons and quizzes, but no way to turn that material into a scheduled review habit without retyping cards or converting formats. Tessera takes a deck that Claude writes, validates it, and schedules reviews so the learner retains it.

## Users

| Persona | Description | Primary need |
|---|---|---|
| **Primary: the owner** | Systems administrator studying for certifications (CCNA first), runs a homelab, uses Claude as a tutor. | Paste a Claude deck, study it fast on any device, send weak spots back to Claude. |
| **Secondary: self-hosting learners** | Homelab and self-host community members who study technical subjects with an LLM. | `docker compose up`, a clear deck format, no accounts or cloud. |

## Jobs to be done

1. When Claude has written me study material, I want it in a review system within a minute, so I start studying instead of reformatting.
2. When I keep forgetting certain cards, I want Claude to rewrite them, so my weak spots improve.
3. When an exam is close, I want to cram without ruining my long-term schedule.

## User stories and acceptance criteria

| ID | Story | Acceptance criteria |
|---|---|---|
| US-1 | As a learner I can import a Claude-generated deck by pasting text, dropping a file, or calling the API. | JSON and Markdown both accepted. Preview shows new, updated, unchanged counts before commit. A 500-card deck imports in under 2 seconds. |
| US-2 | As a learner I can fix a bad deck by pasting errors back to Claude. | Every error names the exact field path and states the allowed values. "Copy errors for Claude" produces a complete fix request. A failed import changes nothing. |
| US-3 | As a learner I can study due cards using only the keyboard. | Space reveals, 1 to 4 grades, each grade button shows its next interval. Session ends with a summary. |
| US-4 | As a learner I can study basic, cloze, typed, and choice cards. | Typed answers ignore case and extra whitespace and honor the accept list. Cloze items are scheduled independently. Siblings are buried for the day. |
| US-5 | As a learner I can re-import an updated deck without losing progress. | Matching card ids keep their schedule and history. Cards missing from the file are untouched unless "archive missing" is chosen. |
| US-6 | As a learner I can see leeches and weak tags and send them to Claude. | Leech flagged at 8 lapses (configurable). Weak-spot report contains full card content, lapse counts, and typed wrong answers, and works as a paste-ready prompt. |
| US-7 | As a learner I can cram a deck before an exam. | Scope by all, tag, or weakest. Grades never change FSRS state. |
| US-8 | As a learner I can see how I am doing. | Dashboard shows today's reviews, retention, 30-day forecast, streak, per-tag retention. |
| US-9 | As an operator I can run and back up Tessera easily. | `docker compose up` starts a healthy instance. Backup is one downloadable snapshot or one file copy. Pre-migration backup is automatic. |
| US-10 | As a Claude user I can generate valid decks reliably. | Repo ships the `tessera-deck` skill and the `/api/schema` JSON Schema. Golden fixtures import cleanly. |

## Success metrics

| Metric | Target |
|---|---|
| Time from "Claude has written a deck" to first review | Under 60 seconds |
| Claude-generated fixture decks that import on the first try | At least 90 percent across the golden set |
| Study days by the owner in the first month after M2 | At least 5 distinct days (also the checkpoint gate) |
| Fresh host quickstart (README to running instance) | Under 5 minutes |
| Scheduler conformance with the `ts-fsrs` reference | 100 percent on fixtures |

GitHub stars and downloads are explicitly not success metrics.

## Scope

### In v1 (must)

US-1 through US-5, US-9, US-10. These are the minimum that make the Claude round trip real.

### In v1 (should)

US-6 (leeches and weak-spot report), US-7 (cram mode), US-8 (stats). Selected by the user and shipped in M3 and M4.

### Out of v1

Accounts and multi-user, images and media, MCP server, auto-generated choice distractors (v1.1), native apps, sync services, in-app LLM calls.

## Assumptions

- The owner will keep using Claude to author decks and will paste output into the app.
- Self-hosting on the homelab behind an authenticating reverse proxy or VPN is acceptable.
- Text-only cards (Markdown, code, Mermaid) cover cert study content.

## Open questions

- Whether Brainy's source reveals features worth matching (answered in Phase 2).
- Whether Mermaid rendering is needed in M1 or can land with M2 (EM decides in Phase 3).
- Final visual direction for the UI (decided at implementation, using the design skills).
