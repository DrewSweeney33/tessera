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

## Owner requests added to the plan (2026-10-12)

The owner asked for these to be added to the plan: (1) a way to **manually add decks**, (2) **edit existing decks**, (3) **retrain on decks after completion**, (4) **delete decks**, (5) **back up from the GUI**. The owner added that there are probably other features they want, and asked for these to be added now. This is a scope change, so the team treats it as a re-plan (the EM risk table says new work waits for one). **Nothing here is built.** The checkpoint gate still applies to milestone ordering: whether these come before or after the weak-spot work is the owner's call (see "Questions for the owner" below).

### Why it matters for the product

Tessera was designed as file-first: Claude writes a deck, Tessera imports it, and re-import by `id` keeps progress. The owner now wants to manage decks without Claude in the loop, which makes Tessera a deck manager as well. That is a real change of pitch, so the CTO file records it. It also removes the main friction a flashcard app has (a typo in one card currently means a trip through Claude or a hand-edited file), and it is what Flash and Anki users expect.

### User stories

| ID | Story | Acceptance criteria |
|---|---|---|
| US-11 | As a learner I can create a deck by hand. | A "New deck" action takes a title, an optional description, and tags, and makes an id from the title (a lowercase slug, checked for uniqueness, with a clear message if it is taken). The new deck exists with no cards and can be studied once it has some. Created decks use the same id rules as imported ones (`^[a-z0-9][a-z0-9-]{0,63}$`, as the schema defines). |
| US-12 | As a learner I can add, edit, and remove cards in any deck, and edit the deck's title, description, and tags. | A card editor covers all four types (basic, cloze, typed, choice) with a live preview of the rendered Markdown. It validates with the same rules and messages as import, naming the field. Editing a card's text keeps its progress. Changing a card's type warns that progress is erased (as import does). Removing a card archives it (progress kept, restorable) unless the learner picks permanent removal. The editor never saves an invalid card. |
| US-13 | As a learner I can practice a deck again after finishing it. | Two clearly different actions. **Practice again** (also called cram) studies the whole deck, or a tag, or the weakest cards, any time, and grades never change the schedule (this is US-7 in M4). **Start over** resets a deck's progress so every card is new again, after a typed confirmation, and only after an automatic snapshot (see ADR-014). *The words "retrain" and "after completion" are ambiguous. The team assumed both meanings. The owner confirms or narrows it.* |
| US-14 | As a learner I can delete a deck without fear. | Delete moves the deck to a **Trash** (the deck's existing `archived` flag), hides it everywhere, and keeps its cards and review history. The Trash lists decks with their card and review counts, and each can be restored or deleted permanently. Permanent deletion needs the deck's title typed as confirmation, is preceded by an automatic snapshot, and says in plain words that the review history of the deck goes with it. |
| US-15 | As an operator I can back up and see my backups from the GUI. | A Backups page has **Back up now** (writes a snapshot into the data folder's `backups` folder and shows its name and size), a list of existing snapshots (automatic pre-upgrade ones and manual ones, with dates and sizes), **Download** for any of them, and **Delete** for old ones (with a confirmation). The page says that a backup left on the same disk does not protect against losing the disk. A full disk gets the plain HTTP 507 message. |
| US-16 | As an operator I can restore from a backup in the GUI (stretch). | Upload a snapshot or pick one from the list. The server checks it (integrity, the migration level, that it is a Tessera database), shows what it contains, takes an automatic snapshot of the current data first, and applies it. The server cannot swap the database file under itself safely, so the application restarts itself to apply it, and the page says so (ADR-014 sets out how). Not in the first cut unless the owner asks for it. |

### Candidate features to confirm (the owner said there are probably others)

Not requirements. A list for the owner to cross out or promote, gathered from the plan, the competitor check, and what a daily user usually reaches for next:

- Search across cards (and by tag), and a deck list that can be filtered or sorted.
- Suspend or bury a single card from the study screen.
- Move a card to another deck, copy a deck, merge two decks.
- Per-deck settings (daily limits and target retention for one deck, not only global ones).
- Undo the last grade (already deferred to v1.1).
- Study ahead (review cards that are not yet due).
- A daily goal and a streak (part of the stats dashboard in M4).
- A keyboard shortcut help overlay.
- Import from Anki `.apkg` (Flash does it).
- Images and audio in cards (a stated non-goal, because of storage and the CSP).
- Reordering cards, and folders or nested decks.
- Export of study history as CSV.

### Questions for the owner (not blocking, the team assumed the answers shown)

1. **"Retrain on decks after completion"**: does it mean practice again without changing the schedule, start over from scratch, or both? *Assumed both, as US-13.*
2. **Delete**: is a Trash with restore acceptable, or does the owner want an immediate, permanent delete? *Assumed Trash first, with permanent delete behind it (US-14).*
3. **Editing versus re-import**: if the owner edits a card by hand and later re-imports an older Claude version of the deck, the re-import preview shows the hand edit as a change to be overwritten, and the owner decides. *Assumed this is enough, with no "locked card" feature (ADR-013).*
4. **Restore from the GUI**: wanted now, or is download plus the documented restore steps enough for the first cut? *Assumed later (US-16 is a stretch).*
5. **Order**: library management before or after the weak-spot work? *Recommended before: it is what the owner needs to use the app daily, and it feeds the checkpoint.*

### Owner's answers (2026-10-12)

The owner accepted ADR-013 and ADR-014 and said "next milestone", with no changes. That settles the five questions as the team assumed them: (1) "retrain after completion" means both practice again (no effect on the schedule) and start over (reset progress); (2) delete goes to a Trash first, with permanent delete behind it; (3) a hand edit that a later re-import overwrites is shown in the import preview and the owner decides, with no locked cards; (4) restore from the GUI comes after backup, download, and the snapshots, as a stretch (L-09) that is in the plan but built last; (5) library management (milestone L) comes before the weak-spot work. The owner has not yet listed other features, so the candidate list stands as candidates.

**The checkpoint gate** (5 study days) was overridden by the owner's instruction to start the next milestone. The CTO file records this.

## Milestone 4 scope decisions (2026-10-17)

Owner's answers in the design conversation. They refine US-7 (practice) and US-8 (statistics), and the "practice again" half of US-13.

- US-7 as built: practice again covers **one deck or one folder** (not tag, not weakest-only). Count choices 20, 50, 100, all (default all). Order: shuffled or weakest first. A missed card **loops back** in the session until answered right once. Grades never change FSRS state. Tag scope can follow later.
- US-8 as built: a **/stats page with a scope picker** (all decks, a folder, a deck): today, retention, streak, 26-week heatmap, 30-day forecast, items by stage, per-tag retention, practiced today.
- New: a folder can carry an **exam date**, shown as a countdown, with a Practice folder suggestion in the last 14 days. Not on decks.
- Success criteria: practice leaves every schedule byte-identical; study numbers are unchanged by practice rows; the stats page loads in under a second on a 100,000-row log.

## M6 decisions (2026-10-18, with the owner)

- The owner's next four directions, in the order they confirmed: study quality, safe on the network, the Claude authoring loop, close out toward 1.0.
- **US-23 Undo the last answer.** One step only: the last answer on the study or practice screen. It restores the card's schedule exactly and removes the grade from the statistics and the daily limits. Several steps and a history list are out of scope.
- **US-24 Move cards in the editor** (backlog B-4): Move up and Move down, keyboard friendly.
- **US-25 Practice a tag**: a third practice scope, reached from the weakest-tags lists on Statistics and Leeches.
- **US-26 Quiz me** (was "auto-generated choice distractors", deferred): Practice only. Basic and typed cards shown as multiple choice with wrong options taken from other cards' answers. Never in study, because recognition graded into the schedule would make intervals too long. No change to the deck format.
- Success criteria: undo leaves every card state, log, and count byte-identical to before the answer; a quiz question always has its right answer once and never changes on a reload; practice by tag changes no schedule.
