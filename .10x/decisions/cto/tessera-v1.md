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

## Phase 2 update (2026-10-10)

The Brainy repository page was read directly. It is a Tauri desktop app with no Docker files, and the repository is **archived by its owner and read-only**. The strategic case is stronger than assumed in Phase 1: the closest open source competitor is desktop-only and no longer maintained. The "Brainy closes the gap" risk is downgraded. Anki remains the real alternative. Internals of Brainy's source were not inspected beyond the repository listing.

## Sources

- [awesome-fsrs list of FSRS apps](https://github.com/open-spaced-repetition/awesome-fsrs)
- [Anki self-hosted sync server docs](https://docs.ankiweb.net/sync-server.html)
- [Brainy Learn Snap listing](https://snapcraft.io/brainy-learn)
- npm registry queries for `ts-fsrs`, `better-sqlite3`, `@sveltejs/kit` run 2026-10-10
- Prior vault note `2026-10-10-flashcard-app-naming` for the earlier competitor search

## Competitor re-check, M3-11 (2026-10-12)

Done early, as research only, because the owner asked the team to keep following the plan unattended and the plan's checkpoint (see above) blocks building M3 features until the owner has studied on 5 separate days. Sources were read on 2026-10-12. Search coverage of GitHub-only projects is still shallow.

**New and relevant: Flash** (`github.com/flash-cards/flash`, AGPL-3.0-only, described as "spaced-repetition flashcards you study with your AI. Self-hostable and MCP-native"). Read from its repository page and a Glama listing:
- Rust, one binary and one SQLite file, Docker Compose quickstart, web UI, FSRS scheduling, statistics, `.apkg` import and export (cloze, hints, images, audio, LaTeX, typed answers, nested decks), CSV, optional AI card generation from text, PDFs, images, and video, optional voice study.
- Its AI link is an **MCP server**: Claude, ChatGPT, or another MCP client creates cards, quizzes, grades, and records reviews directly. Claude.ai and the Claude mobile app need a **public HTTPS address** (a reverse proxy or a tunnel); Claude Desktop and Claude Code on the owner's own machine can use a LAN address. The web UI needs HTTPS or localhost for its session cookie.
- Accounts and sign-in (passkey or password), invite-only on self-hosted installs.
- **Not mentioned anywhere I could read:** leeches, weak spots, cram mode, a file-based deck format other than `.apkg` and CSV, and a strict schema with a preview step.
- Maturity: 3 stars, 0 forks, 5 commits on main, no releases listed (the README refers to version 0.3), no commit dates shown. Glama lists it as "Maintained". Its own listing says it "cannot be deployed" there. This is an early project, and I could not verify its current activity.

**What it changes.** The Phase 2 update said the closest open-source competitor (Brainy) is archived and desktop-only. That is still true of Brainy, but Flash is a closer match to Tessera's pitch: self-hosted, web, FSRS, and driven by Claude. It reaches Claude by a different route, a live connector, where Tessera uses a validated file round trip. Where Tessera differs, as of today:
1. **Private by default.** Tessera needs no connector and no public address, so it fits a VPN-only homelab. Flash's Claude.ai route needs the app on the public internet or a tunnel.
2. **The round trip is the feature.** A strict schema, an import preview, errors that name the field, and (in M3) the weak-spot report that goes back to Claude. Flash does not mention leeches or weak spots, which is the feature M3 builds.
3. **No accounts.** One user and one file, by design (ADR-005).

**Where Flash is ahead:** `.apkg` import, voice study, built-in AI generation, a hosted version, and live Claude interaction without copy and paste.

**Implications for the owner's checkpoint, not decisions.**
- M3's weak-spot round trip (US-6) is now the clearest reason to continue, because it is the part a connector-driven app does not describe.
- ADR-005 and the spec list MCP as a non-goal. That stands. If it is ever revisited, note that the cost is the public-address requirement above.
- Re-check Flash at M3 exit and before `v1.0.0`: its activity, whether it adds leeches or weak spots, and whether `.apkg` import matters to the owner. The "stop expanding and switch to Anki plus a `.apkg` skill" criterion is unaffected.

**Anki.** The stable release listed on Wikipedia is 26.09.3 (23 September 2026). The 26.08 beta notes mention fsrs-rs 6.6.1 and an experimental editor. I found no built-in AI card generation in official notes. AI card creation for Anki comes from third-party tools (for example anki-llm and Chrome extensions that use a bring-your-own key). The "Anki plus a skill" fallback stays viable.

**Other FSRS apps** (awesome-fsrs list): Jiaci, Jolito, spacedrep (a command-line tool and MCP server with `.apkg` import), MemPro (hosted), SiYuan. None clearly combines self-hosting, a web UI, and an LLM deck import format. Their maintenance could not be judged from the list.

**Commercial** (Avorio, Discito, Deckbase and similar): hosted or native Apple apps, unchanged since Phase 1.

Sources: [Flash repository](https://github.com/flash-cards/flash), [Flash on Glama](https://glama.ai/mcp/servers/flash-cards/flash), [awesome-fsrs](https://github.com/open-spaced-repetition/awesome-fsrs), [Anki releases](https://github.com/ankitects/anki/releases), [Anki on Wikipedia](https://en.wikipedia.org/wiki/Anki).

## Scope change: library management (2026-10-12)

The owner asked for manual deck creation, editing, practice again and start over, deck deletion, and backups from the GUI, and said more requests are likely. This does not trigger either kill criterion: the checkpoint measures whether the owner studies with Tessera, and these requests are what the owner needs in order to do that every day.

**Strategic effect.** Tessera was pitched as file-first with Claude in the loop. It now also needs to be a deck manager. That is a wider product, and a bigger maintenance load for one maintainer. The team keeps it bounded: manual edits go through the existing import pipeline (ADR-013), no accounts, no images or audio, and no second write path. Flash and Anki users expect this feature set, so leaving it out would cost the owner's daily use more than building it costs.

**Does it change the differentiator?** No. The validated file round trip, the privacy of a VPN-only deployment, and the weak-spot report (M3) remain the reasons to prefer Tessera over a connector-driven app.

**Cost.** About 32 net hours (EM file). ADR-013 and ADR-014 are Proposed and wait for the owner. The scope-creep risk in the EM table still applies: each further request gets a story, a place in the order, and a size before it is built.

## Checkpoint override (2026-10-12)

The owner accepted ADR-013 and ADR-014 and told the team to start the next milestone, which is milestone L (library management), before the 5 study days the "continue past M2" criterion asks for. The CTO treats this as an informed override by the one person the criterion exists to protect: the owner has Tessera running at home (0.1.1 since 2026-10-12) and is asking for the features needed to use it daily. The "stop and switch to Anki plus a `.apkg` skill" criterion is **not** waived: it remains the fallback if, after the library work, the import loop is not noticeably smoother than Anki. The checkpoint is recorded as "overridden, not met", and the study-day count is still worth tracking.
