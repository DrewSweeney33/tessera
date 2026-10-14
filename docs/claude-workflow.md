# Making decks with Claude

Tessera is built so that Claude can write a deck and you can import it without editing. This page shows how to ask, how to import, and how to fix a deck that does not import. The format itself is in [deck-format.md](deck-format.md).

## The short version

1. Give Claude your material and ask for a Tessera deck.
2. Paste the reply into **Import**, press **Preview**, then **Import**.
3. If there are errors, press **Copy errors for Claude**, paste that into the same chat, and import the corrected deck.
4. Study.

## Set Claude up once

**With the skill.** This repository contains a Claude skill, [`claude-skill/tessera-deck/SKILL.md`](../claude-skill/tessera-deck/SKILL.md). It teaches Claude the format and how to write good cards. Each release also attaches it as a zip (`tessera-deck-skill-<version>.zip`), which is the form to upload where a Claude app asks for a skill file. Install it the way your Claude app installs skills, by adding the `tessera-deck` folder. (For Claude Code, that is the `skills` folder in your Claude configuration directory, or `.claude/skills` in a project.)

**Without the skill.** Paste the contents of `SKILL.md` into the chat, or into a project's instructions, before you ask. Claude then has everything the skill has.

Either way, Claude does not need to reach your Tessera. Everything it needs is in the skill. If you would like it to check the format against your own copy, give it the address `http://YOUR-ADDRESS:3000/api/schema`.

## Asking for a deck

Be specific about three things: **what the cards should be built from**, **how many**, and **what you want to be able to do afterwards**.

> Make a Tessera deck from the notes below. About 30 cards. Mostly typed cards for commands and terms, cloze cards for lists and sequences, and a few multiple choice cards with an explanation. Give every card an id. Reply with the deck only, in one code block.
>
> (paste your notes or the chapter text)

What helps:

- **Give it the material.** A deck written from your notes or the chapter you are reading is about what you are studying. A deck written from nothing is about whatever Claude remembers, and it can be wrong.
- **Ask for a number.** 20 to 60 cards from one piece of material is a good size. For more, ask for one deck per topic.
- **Say which types you want.** Typed cards for exact commands and terms, cloze for lists and sequences, multiple choice for telling similar things apart, basic for explanations.
- **Name the format.** Markdown is easier to read and for Claude to get right when there is code. Say "Markdown" or "JSON".
- **Name the deck.** "Call the deck `ccna-ospf`" gives you a good deck id. Importing the same id later updates that deck.

## Importing

1. Open **Import** and paste the whole reply. A code block around it is fine, and so is the "Reading this as Markdown" or "JSON" note that appears.
2. Press **Preview**. For a new deck it shows how many cards there are. For a deck you already have, it shows what changes.
3. Press **Import**. Nothing is saved before this.

You can also drop a file on the box, or use **Choose files**. Pick several files at once and each one is previewed and imported as its own deck, so a file with a mistake never holds back the others.

## When it does not import

Claude sometimes gets a detail wrong. The import page lists every problem with the line or the field. Press **Copy errors for Claude** and paste the result into the same chat. It asks for the corrected deck in the same format and tells Claude to keep every id. This normally fixes everything in one round trip.

The most common problems, and what they mean:

| What you see                         | Usually                                                          |
| ------------------------------------ | ---------------------------------------------------------------- |
| The text does not start with `{`     | Claude added a sentence before the deck. Delete it, or ask again |
| The JSON ends before it is complete  | The reply was cut off. Ask for the deck in two smaller decks     |
| A card has a `Q:` but no answer      | A missing `A:`, `Answer:`, or `Choices:`                         |
| No choice is marked as the right one | The `[x]` is missing in a multiple choice card                   |
| This line looks like a field label   | A line after the choices was indented. Remove the indent         |
| Text is before the first card        | An introduction was left in the deck                             |
| A code block is never closed         | A missing closing line of backticks                              |

## Checking what Claude wrote

Claude can state something wrong with confidence, and a flashcard that teaches a wrong fact is worse than none. Before you study a new deck:

- Read the cards. Skim every one against your source.
- Ask Claude to add a `source` to each card, such as `Chapter 4`, so you can look it up later.
- When a card turns out to be wrong, fix it and import again (below). Your history stays.

## Changing a deck

Keep the file you imported, or get the deck back out of Tessera (see "Without the web page" below). To change a deck:

1. Give Claude the deck and say what to change: "add five cards about X", "make card `ospf-hello` clearer", "the answer to `ospf-dr` is wrong, it should be ...".
2. Tell it to **keep every existing id** and to reply with the whole deck.
3. Import it and read the **Preview**. It shows the old and new text of every card that changed, and warns you if cards were removed, if a card changed type (which would reset its history), or if new cards look like old ones under new ids.

If the preview says something you did not expect, do not import. Ask Claude what it changed.

## Without the web page

A script, or Claude Code on your computer, can send a deck straight to your Tessera:

```bash
curl -X POST -H "Content-Type: text/markdown" --data-binary @deck.md "http://tessera.lan:3000/api/import?dry_run=true"
```

Leave off `?dry_run=true` to save it. If you set an API token, add `-H "Authorization: Bearer YOUR_TOKEN"`. Both are described in [deploy.md](deploy.md).

To get a deck back out, ask for its export. The deck's id is the one on the home page. The file name comes from the id, and `format=md` gives Markdown instead of JSON:

```bash
curl -OJ "http://tessera.lan:3000/api/decks/ccna-ospf/export"
curl -OJ "http://tessera.lan:3000/api/decks/ccna-ospf/export?format=md"
```

The export has every card with its id, type, text, tags, and order, so importing it again changes nothing. Cards you removed are not in it. A deck in the Trash cannot be exported. If a deck has content that Markdown cannot hold (a card that starts with spaces, for example), the Markdown export says so and names the card, and the JSON export always works.

## Edit a deck by hand

You do not need Claude to fix a typo. Press **Edit** on a deck in the list. The page shows the deck details and every card. Open a card to change its text, with a preview of how it will look when you study it. Add a card of any of the four types, or remove one, and change the title, description, and tags.

Nothing is saved until you press **Review changes**. That shows the same preview as an import: which cards change, the old and new text, and which cards are removed. Then **Save changes** applies it. It goes through the same code as an import, so a card you edit keeps its id and everything you studied on it. A card you remove is archived, not deleted: kept with its history and no longer studied. You can put a removed card back until you save.

A few things to know:

- **A card keeps its type.** Changing a card from basic to cloze would erase what you studied on it, so the editor does not offer it. Remove the card and add a new one.
- **A deck needs at least one card** to be saved. To get rid of a deck you are done with, move it to the Trash (see below).
- **If the deck changed somewhere else** (another tab, or Claude re-importing it) after you opened the editor, saving is refused and nothing is lost. The page tells you, keeps your edits on screen so you can copy any text, and offers to reload the deck.
- **Studying in another tab does not get in the way.** Only changes to the deck itself count.
- **Leaving with unsaved changes** asks first.
- **Export JSON** and **Export Markdown** are buttons at the top of the editor, the same files as the routes above.

For scripts: `GET /api/decks/:id` returns the deck as a document plus a `revision`. Send that revision back as `expected_revision` on `POST /api/import` and a save made from an out-of-date copy is refused with HTTP 409 instead of overwriting newer changes.

## Start a deck over

Press **Start over…** at the top of a deck's editor to study the whole deck again from scratch. Every card goes back to new, as if you had never studied it. The cards themselves are not changed, and your review history is kept (it still counts in statistics, and Tessera records when the deck was started over). You have to type the deck's title to confirm, and Tessera saves a copy of your database first. The page shows its name, starting with `pre-reset-`. If that copy cannot be written, nothing changes.

This is different from practising a deck again without affecting the schedule, which is planned for a later version.

For scripts: `POST /api/decks/:id/start-over` with `{"confirmTitle": "..."}`.

## When cards keep failing: the weak-spot loop

Some cards you will keep getting wrong. After a card has lapsed eight times Tessera flags it as a **leech**. It is never hidden or suspended by itself: the point is to fix it.

Open **Leeches** from the deck list (it shows how many need attention). Each leech is shown as a card, with the deck, how many times you lapsed, when you last reviewed it, and, for typed cards, the wrong answers you typed. For each one you can:

- **Edit deck** to fix the card yourself.
- **Reset** it when you have fixed it: the flag and the lapse count go, the schedule and history stay.
- **Set aside** to take it out of your study sessions until you **Put back**.

**Copy the weak-spot report for Claude** puts one block of text on your clipboard (or shows it to copy, if the browser refuses). Paste it into a chat with Claude, with the Tessera skill installed or its contents pasted. It contains:

- the instruction to Claude: rewrite these so they are easier to learn, keep every `id` and `type`, and reply with only the cards it changed
- your leech cards, grouped by deck, each deck as a ready-made deck block in the import format, with the lapses and the wrong answers you typed
- your weakest tags (from your reviews of cards you had already learned, over the last 90 days, with at least ten reviews each)

Claude answers with a deck block holding the revised cards. **Import it as usual.** Because every card keeps its id, the revised cards replace the old text and keep everything you studied. The preview shows the old and new text of each, so you can check it. A leech you have rewritten stays flagged until you **Reset** it, or until you do well on it. Cards that are not in Claude's answer are left alone.

The report holds at most 40 cards and about 60,000 characters, worst first, and says how many it left out. Fix those, import, and copy the report again. A card is never cut in half.

For scripts: `GET /api/report/weak-spots` (add `?format=json` for JSON, `&deckId=` for one deck), `GET /api/leeches`, `POST /api/leeches/:cardPk/:ordinal/reset`, `POST /api/cards/:cardPk/suspend` and `/unsuspend`.

## Delete a deck: the Trash

Press **Move to Trash** at the top of a deck's editor. The deck leaves your deck list and your study sessions, but nothing is deleted: its cards, its schedule, and everything you studied wait in the Trash. Open **Trash** from the deck list to see them.

- **Restore** puts a deck back exactly as it was, with its progress.
- **Delete for good** removes the deck, its cards, and its review history for good. You have to type the deck's title to confirm, and the page says how many cards and reviews go with it. Before anything is removed, Tessera saves a copy of your whole database in the `backups` folder (the page shows its name, starting with `pre-delete-`). If that copy cannot be written, for example because the disk is full, nothing is deleted. Restoring that copy brings the deck back (see the operations guide).
- A deck's id stays taken while it is in the Trash, so a new deck cannot reuse it by accident. Once a deck is deleted for good, the id is free again.
- Importing a file whose deck id is in the Trash brings that deck back (the same as restoring it), and then applies the import.

For scripts: `GET /api/trash`, `POST /api/decks/:id/trash`, `POST /api/decks/:id/restore`, and `POST /api/decks/:id/delete-forever` with `{"confirmTitle": "..."}`. They need the API token when one is set, like every other write.

## Good cards

The skill asks Claude for these. You can ask for them too.

- **One fact per card.** If an answer needs "and", split it.
- **Questions that have one right answer.** "What is the default hello interval on broadcast networks?" and not "Tell me about OSPF timers".
- **Cloze for lists and sequences.** The order of the TCP handshake, the parts of a command, a rule with several terms.
- **Typed for exact words.** Commands, flags, port numbers, acronyms. Add the short forms people use to `accept`.
- **Multiple choice for telling similar things apart.** With wrong options that someone could believe, and an explanation.
- **Short.** A card you can answer in a few seconds is a card you will actually review.
- **Self-contained.** The question should make sense without the card before it.

## What is not here yet

Practising a deck again without changing its schedule, and backups from the web page, are planned for the next version. Statistics and a settings page are planned for a later version.
