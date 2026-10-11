# CTO Decisions: tessera-v1

**Date:** 2026-10-10
**Phase:** 1 Strategy
**Spec:** `.10x/specs/2026-10-10-tessera-design.md`

## Problem

The user studies with Claude as a tutor (certifications, starting with CCNA) and wants active recall on material Claude writes. Today the output is printable lessons and quizzes. Nothing turns a Claude-written deck into a scheduled review habit without manual card entry or a conversion step.

## Verdict: Build, with a checkpoint

Confidence is moderate. The market for flashcard apps is crowded and a decent "buy" path exists. The build is justified by one defensible differentiator and a low infrastructure cost. It is capped by a checkpoint (see "Kill and continue criteria").

## Build vs buy

| Option | What it gives | Why it falls short for this goal |
|---|---|---|
| **Anki desktop plus Claude writing decks** | Mature, FSRS support, huge ecosystem, `.apkg` and CSV import. Re-import by GUID can update notes. | Needs a desktop client and an Anki sync server for multi-device use. Claude must output `.apkg` or CSV, which has no strict schema feedback loop. No weak-spot report back to Claude. AnkiConnect needs the desktop app running. This is the strongest alternative. |
| **Brainy** (open source, AGPL-3.0 per its Snap listing) | AI card generation from uploaded material, FSRS, notebooks, cloze cards, sync. | Distributed as a desktop app (Snap and GitHub releases). Its AI generation is built in rather than driven by an external Claude session, and it has no documented import schema for external generators. I could not read the repository directly, so these points come from listings and are unverified. Worth reading its source before design freezes. |
| **Other FSRS apps** (SiYuan, Jiaci, Jolito, TiddlyWiki plugin, Read Frog) | FSRS scheduling in web, notes, or vocabulary contexts. | Domain-specific or note-taking tools. None offers an LLM-generated deck import format. |
| **Simple Docker flashcard apps** (BrainGains, Flipper Card App, others) | Self-hostable. | Leitner or basic scheduling, no FSRS, no AI workflow. |
| **Commercial apps** (Avorio, Discito, Deckbase and similar) | Polished FSRS and AI features. | Closed, paid, Apple-centric, not self-hosted. |

Sources are listed at the bottom. Search coverage was shallow for GitHub-only projects, so a newer self-hosted competitor may exist.

## Differentiator

The Claude round trip: a strict versioned deck schema with Claude-fixable errors, idempotent re-import that preserves review history, and a weak-spot report that feeds leeches back to Claude for rewriting. Zero client install: it is a web app reachable from any device on the homelab network. None of the researched alternatives combines these.

Honest caveat: Anki can approximate the loop with `.apkg` generation and GUID updates. Tessera's advantage is a smoother, schema-validated, web-based loop, not a capability Anki cannot reach at all.

## Technology direction

Confirms the brainstorm choices (SvelteKit, TypeScript, SQLite, Drizzle, Zod, `ts-fsrs`, single Docker container). Versions checked on 2026-10-10:

| Package | Version | License |
|---|---|---|
| `ts-fsrs` | 5.4.2 (`latest`), 6.0.0-beta.14 on `beta` tag | MIT |
| `better-sqlite3` | 13.0.3 | MIT |
| `@sveltejs/kit` | npm reports 3.0.1. Re-verify at scaffold time. | not checked |

Direction: pin `ts-fsrs` to the stable 5.x line, do not adopt the 6.0 beta in v1. All checked dependencies are MIT, which is compatible with an AGPL-3.0 application.

## Cost and effort posture

- No recurring cost. No hosted services, no model calls, no accounts to run.
- One maintainer. Scope is already trimmed (no accounts, no media, no MCP). Further growth waits for the checkpoint.
- CI minutes on GitHub Actions and GHCR hosting are free for public repositories.

## Strategic risks

| Risk | Impact | Response |
|---|---|---|
| Brainy or Anki closes the gap | Differentiator shrinks | Read Brainy's source in Phase 2. Keep the schema and weak-spot loop as the focus, not general flashcard features. |
| Tool built for one user, no adoption | Wasted OSS effort | Accept. Primary value is the owner's own study. Open source is a bonus, not a success requirement. |
| Scope creep toward a full Anki clone | Never ships | Non-goals list in the spec. Review at each milestone. |
| Exposed instance without auth | Data exposure | Explicit docs, optional API token, non-root container. |

## Kill and continue criteria

- **Continue past M2** (basic, cloze, typed, choice cards plus Markdown import) only if the owner has used Tessera for real study on at least 5 separate days with a Claude-generated deck.
- **Stop expanding and switch to Anki plus a `.apkg` generator skill** if the import loop is not noticeably smoother than that route after M2.
- Re-check competitors (Brainy releases, Anki features) at M3.

## Sources

- [awesome-fsrs list of FSRS apps](https://github.com/open-spaced-repetition/awesome-fsrs)
- [Anki self-hosted sync server docs](https://docs.ankiweb.net/sync-server.html)
- [Brainy Learn Snap listing](https://snapcraft.io/brainy-learn)
- npm registry queries for `ts-fsrs`, `better-sqlite3`, `@sveltejs/kit` run 2026-10-10
- Prior vault note `2026-10-10-flashcard-app-naming` for the earlier competitor search
