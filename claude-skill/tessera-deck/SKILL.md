---
name: tessera-deck
description: Write flashcard decks in the Tessera format, in Markdown or JSON, so they import into the user's Tessera study app without edits. Use when the user asks for flashcards, a study deck, spaced repetition cards, or cards for Tessera, or pastes import errors from Tessera and wants the deck fixed.
---

# Writing Tessera decks

Tessera is a self-hosted flashcard app. The user imports a deck file, and it must import the first time. The importer is strict: it refuses a whole deck if anything is wrong, and lists every problem. Your job is to write cards that are good to study **and** valid. Follow the rules here exactly.

## What to do

1. **Work from the user's material.** If they gave notes, a chapter, or a topic with a source, build the cards from that. If they gave only a topic, say so, and tell them cards written from memory should be checked against a source before they study. Do not invent facts, commands, numbers, or quotes. If you are not sure, leave the card out or say so.
2. **Decide the size.** Aim for 20 to 60 cards unless told otherwise. For more than that, offer several decks, one per topic.
3. **Pick the format.** Use **Markdown** unless the user asks for JSON. Markdown is easier to write without mistakes when cards contain code, quotes, or several lines.
4. **Give every card an `id`.** A short, meaningful, lowercase-with-hyphens word, unique in the deck, for example `ospf-hello`. The id is how the user's review history stays with a card when the deck is revised.
5. **Reply with the deck and nothing else**, in one code block, so it can be pasted straight in. No introduction and no closing remarks inside the block. Put any note to the user after the block. If the deck contains code blocks, use **four backticks** (or `~~~~`) for the outer fence so the inner ones do not end it.
6. **Check it against the checklist at the end** before you send it.

## Writing good cards

- **One fact per card.** If the answer needs "and", split it.
- **A question with one right answer.** "What is the default OSPF hello interval on broadcast networks?" and not "Tell me about OSPF timers".
- **Short.** A card you can answer in a few seconds gets reviewed.
- **Self-contained.** The question must make sense on its own, without the previous card.
- **Use the type that fits:**
  - `typed` for exact words: commands, flags, port numbers, acronyms, terms. Put the short forms people really use in `accept`.
  - `cloze` for lists, sequences, and rules with several terms. One blank per fact, usually two to four per card.
  - `choice` for telling similar things apart. Make the wrong options things someone could believe, and always add an `explanation`.
  - `basic` for explanations and "why" questions.
- **Code goes in fenced code blocks with a language name.** Highlighted languages: bash, c, cpp, csharp, css, diff, dockerfile, go, html, ini, java, javascript, json, markdown, powershell, python, rust, shellsession, sql, toml, typescript, xml, yaml (short names such as sh, ps1, js, ts, py, yml also work). Other languages are shown as plain code.
- **A diagram is a code block named `mermaid`.** Use it where a picture explains better than words (a handshake, a state machine, a flow). Flowchart, sequence, state, class, entity relationship, pie, Gantt, and mind map diagrams work. Keep it under 8,000 characters, quote labels that contain punctuation, and give the diagram its own card or the front of a card whose back shows the answer.
- **Tags and `source`** are optional but useful: a few lowercase tags to group cards, and a `source` such as `Chapter 4` so the user can look it up.
- Text fields are Markdown: bold, lists, tables, links, `inline code`. Raw HTML is shown as text and images are not supported, so do not use them.

## The Markdown format

A deck is a block at the top, then one section per card.

<!-- prettier-ignore -->
```markdown tessera-deck
---
tessera: 1
id: ospf-basics
title: OSPF basics
description: A few cards to try the four types.
tags: [networking]
---

## ospf-hello
Q: Default OSPF hello interval on broadcast networks?
A: 10 seconds
Hint: The dead interval is 4 times this.
Tags: timers
Source: Lesson 3

## ospf-dr
Cloze: The {{c1::DR}} is elected by highest {{c2::priority}}, then by highest {{c3::router ID}}.
Extra: A priority of 0 means the router never becomes DR or BDR.

## ospf-show-nbr
Q: Command to list OSPF neighbors?
Answer: show ip ospf neighbor
Accept: sh ip ospf nei, show ip ospf nei

## ospf-lsa
Q: Which LSA type describes a network segment?
Choices:
- Type 1
- [x] Type 2
- Type 3
- Type 5
Explanation: The DR originates the Type 2 network LSA.
```

Rules:

- The block at the top is between two lines of `---`. It needs `tessera: 1`, `id`, and `title`. `description` and `tags` are optional. **No other fields.**
- Each card starts with `## ` and its id. Do not use `##` for anything else.
- A **field** starts with a label at the very start of a line. A field continues, over any number of lines, until the next label or heading. Labels are `Q:`, `A:`, `Answer:`, `Accept:`, `Cloze:`, `Choices:`, `Explanation:`, `Extra:`, `Hint:`, `Tags:`, `Source:` (and `Type:`, rarely).
- **The card type comes from the labels:** `Cloze:` is a cloze card. `Q:` with `Choices:` is a choice card, with `Answer:` a typed card, with `A:` a basic card. Use exactly one of `A:`, `Answer:`, `Choices:` with a `Q:`.
- Which labels go with which type: basic has `Q:` and `A:`. Cloze has `Cloze:` and optionally `Extra:`. Typed has `Q:`, `Answer:`, and optionally `Accept:`. Choice has `Q:`, `Choices:`, and optionally `Explanation:`. Every type may also have `Hint:`, `Tags:`, and `Source:`. A label that does not belong to the type is an error.
- **Choices** are a list of `- ` items under `Choices:`. Mark the right one with `[x]`, as in `- [x] Type 2`. Exactly one. Two to eight items, no two the same. **Never indent a line after the list**: the next label (`Explanation:`) goes at the start of the line, with no spaces before it.
- `Tags:` and `Accept:` are comma separated. To put a comma inside an item write `\,`.
- **Code blocks are fine anywhere in a field.** Lines inside a code block that look like labels are not read as labels. Always close the block.
- A line of ordinary text that starts like a label or a heading (for example `Q: ...` as part of an answer) needs a backslash in front: `\Q: ...`.
- Nothing may sit between the top block and the first card except blank lines.
- Do not put blank lines inside a single choice. Do not start a field's text with spaces.

## The JSON format

Use it only if asked. One object with `tessera`, `deck`, and `cards`:

```json tessera-deck
{
	"tessera": 1,
	"deck": { "id": "ospf-basics", "title": "OSPF basics", "tags": ["networking"] },
	"cards": [
		{
			"id": "ospf-hello",
			"type": "basic",
			"front": "Default OSPF hello interval on broadcast networks?",
			"back": "10 seconds"
		},
		{
			"id": "ospf-dr",
			"type": "cloze",
			"text": "The {{c1::DR}} is elected by highest {{c2::priority}}."
		},
		{
			"id": "ospf-show-nbr",
			"type": "typed",
			"front": "Command to list OSPF neighbors?",
			"answer": "show ip ospf neighbor",
			"accept": ["sh ip ospf nei"]
		},
		{
			"id": "ospf-lsa",
			"type": "choice",
			"front": "Which LSA type describes a network segment?",
			"choices": ["Type 1", "Type 2", "Type 3", "Type 5"],
			"correct": 1,
			"explanation": "The DR originates the Type 2 network LSA."
		}
	]
}
```

- Every card has a `type` of `basic`, `cloze`, `typed`, or `choice`.
- `basic`: `front`, `back`. `cloze`: `text`, optional `extra`. `typed`: `front`, `answer`, optional `accept` (a list). `choice`: `front`, `choices` (2 to 8 strings), `correct` (the **zero-based** index of the right choice), optional `explanation`. All types: optional `id`, `hint`, `tags` (list), `source`. Any other field is an error.
- Double quotes, no trailing commas, no comments. A line break inside text is `\n`, a quote is `\"`, a backslash is `\\`.
- Do not write anything before or after the JSON.

## Cloze cards

`{{c1::answer}}` hides the answer. The number is 1 to 99 and each number is a separate review item, studied on its own while the other numbers are shown. A hint goes after a second `::`, as in `{{c1::router ID::tie breaker}}`. Several blanks with the same number are hidden together. A cloze card needs at least one blank, every blank must be closed with `}}`, and no answer may be empty.

Use a blank per fact, not per word. `The {{c1::DR}} is elected by highest {{c2::priority}}` is good. Hiding every other word is not.

## Ids and revising a deck

- Ids are lowercase letters, digits, and hyphens, start with a letter or digit, and are at most 64 characters. A card id must be unique in the deck. The deck has its own id, used the same way.
- **When revising a deck, keep every existing id exactly.** Changing an id makes a new card and leaves the old one behind with its history. Add new cards with new ids. If you remove a card, just leave it out.
- Do not change a card's type unless the user asks: it resets that card's review history.
- Reply with the **whole** deck, not only the changed cards.
- **Work from the user's current deck, not from your earlier answer.** The user can edit cards by hand in Tessera (Edit on a deck), so your earlier version may be out of date. Ask them to export the deck (Edit, then Export JSON or Export Markdown) and paste it, then change that and keep every id. Importing a revised deck shows the user the old and new text of every card that changes, so they can keep their own edits.

## The weak-spot report

The user may paste a message that starts "# Tessera weak-spot report". It lists flashcards they keep getting wrong (leeches), each in a ready-made deck block, with the number of lapses and, for typed cards, the wrong answers they typed. Follow the instructions in it, and these rules:

- **Keep every `id` and every `type`.** The ids tie your answer to the user's review history. Changing a type erases that history. If a card would be better as another type, say so in a line and leave the card as it is.
- **Reply with one code block per deck**, in the same format as the block you were given: `tessera: 1`, the `deck` object copied exactly (the id and the title), and **only the cards you revised**. Importing it updates just those cards and leaves the rest of the deck alone. Do not send the whole deck.
- After each code block, say in a line what you changed in each card and why.
- **Fix the cause, not the wording.** A card that is forgotten over and over usually has a reason. Look for these, in this order: it asks for two things (split it into two cards with new ids, and keep the old id on the better half); the question has more than one right answer (add the constraint that makes it one); it is a list or sequence (turn it into cloze blanks); it is an exact command or value (if it is a typed card, put the short forms people use in `accept`; if it is another type, keep the type and suggest in a line that a typed card would suit it, so the user can add one); it needs a hook (add a short explanation, a mnemonic, or a contrast with the card it is confused with). Use the wrong answers typed: they show what the user thinks the answer is.
- A card that is already clear, and only hard, can be left out. Say which, and why.
- The "weakest tags" table is context. It tells you where the user's recall is weakest. Offer to write new cards for those tags if they want, but do not add them to your reply unless asked.
- If the report says no cards are leeches, say so, and offer to look at the weakest tags.

## Fixing import errors

The user may paste a message that starts "My Tessera deck failed to import" and lists problems. Each has a line (Markdown) or a field path such as `cards[3].back` (JSON), a code, and a message. Fix **every** problem listed, change nothing else, **keep every id**, and reply with the complete corrected deck in the same format, in one code block. Common causes:

| Code                                                    | Meaning and fix                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| `cannot_infer_type`                                     | A `Q:` with no `A:`, `Answer:`, or `Choices:`. Add the right one. |
| `ambiguous_card_type`                                   | More than one of those. Keep one.                                 |
| `no_correct_choice`, `multiple_correct_choices`         | A choice card needs exactly one `[x]`.                            |
| `label_in_choice`                                       | A label after the choices is indented. Remove the indent.         |
| `text_before_first_card`, `text_outside_field`          | Stray text. Remove it or put it in a field.                       |
| `unclosed_fence`                                        | A code block was never closed. Add the closing backticks.         |
| `unclosed_cloze`, `invalid_cloze_number`, `empty_cloze` | Fix the `{{cN::...}}` marker.                                     |
| `invalid_format` on an `id`                             | Use lowercase letters, digits, and hyphens.                       |
| `unknown_field`                                         | A field the format does not have. Remove it.                      |
| `required`                                              | A required field is missing.                                      |

## Limits

5 MB per file. 5,000 cards. 20,000 characters in a text field. Titles up to 200 characters, descriptions 2,000, sources 200. Up to 32 tags of 40 characters. Choices: 2 to 8, each up to 2,000 characters. Up to 20 accepted answers of 500 characters. Ids up to 64 characters.

## Checklist before you send

- [ ] Every fact comes from the user's material or is something you are sure of, and anything uncertain is flagged outside the deck.
- [ ] Every card has an `id`, and the ids are unique, lowercase, with hyphens.
- [ ] Each card is one fact, with one right answer.
- [ ] Typed cards have `accept` for the short forms people use.
- [ ] Every choice card has exactly one right choice, wrong options that are believable, and an `explanation`.
- [ ] Every cloze marker is closed and numbered from 1.
- [ ] Every code block has a language and is closed. The outer fence has four backticks if the deck has code blocks.
- [ ] Nothing before or after the deck inside the code block, and no fields the format does not have.
- [ ] In Markdown, no line after a choices list is indented.
