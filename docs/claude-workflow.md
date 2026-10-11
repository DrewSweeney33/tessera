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

You can also drop a file on the box, or use **Choose a file**.

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

Keep the file you imported. To change a deck:

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

Tessera cannot export a deck yet, so keep the file you imported. A weak-spot report, which would let you hand Claude the cards you keep getting wrong and ask for better ones, is planned for a later version.
