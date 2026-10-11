# Performance

Tessera is built for one person's decks, so the budget is generous. The target that matters is the largest import the app accepts: 5,000 cards or 5 MB, whichever comes first. A full import must finish in under 10 seconds. It finishes in about one.

## How to measure

```bash
npm run build
npm run benchmark
```

The script starts the production server on a free port with a throwaway data folder, imports a 5,000 card deck (a mix of basic, cloze, and typed cards, about 1.4 MB of JSON), then times the study endpoints with all of those cards in the database. It exits with an error if any import path takes longer than 10 seconds. CI runs it on every push.

To measure a server you already run, use `node scripts/benchmark.ts --base http://host:3000`. That writes a deck with the id `bench` into it, so point it at a test instance, not at your real data.

## Reference results

Measured on 2026-10-10. Node 24.15.0, Windows 11, a development laptop, production build, SQLite on a local disk. Treat the numbers as an order of magnitude, not a promise.

| Operation                                                     | Time         |
| ------------------------------------------------------------- | ------------ |
| Preview (dry run) of a new 5,000 card deck                    | 94 ms        |
| Import the deck                                               | 1,047 ms     |
| Import the same deck again (nothing changed, nothing written) | 138 ms       |
| Import again with 10% of the cards edited                     | 195 ms       |
| `GET /api/decks` (median)                                     | 12 ms        |
| `GET /api/study/next` (median, 95th percentile)               | 14 ms, 16 ms |
| `POST /api/study/review` (median, 95th percentile)            | 11 ms, 16 ms |

The first import dominates because it writes about 11,500 rows to SQLite in one transaction: 5,000 cards and about 6,500 review items (each cloze blank is its own item). Re-imports skip every card whose content has not changed, so they are close to the cost of reading and hashing the file.

## Why it stays fast

- Queue queries run in SQL with a row limit, ordered by indexed columns (`card_state_due_idx`, `cards_deck_position_idx`), so "next card" reads only the rows it needs and does not scan the deck.
- Import is planned in memory without touching the database, then written in a single transaction. A failure rolls everything back.
- Rendering Markdown happens in the browser for one card at a time.

## What is not measured yet

- A very large review history. The stats work in a later milestone will add a benchmark with a year of simulated reviews.
- Slow storage such as a network share. SQLite over NFS or SMB is not supported. Keep the data folder on a local disk or a Docker volume.
