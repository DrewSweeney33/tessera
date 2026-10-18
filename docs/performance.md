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

## A long history (measured 2026-10-11)

The same 5,000 card deck with 200,000 review records added, which is about five years of 100 reviews a day. Same machine and method as above.

| Measure                                                                            | Result                                                                                                 |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Database file                                                                      | 55 MB (52 MB after a backup compacts it)                                                               |
| `GET /api/decks` (median, 95th percentile)                                         | 11 ms, 14 ms                                                                                           |
| `GET /api/study/next` (median, 95th percentile)                                    | 9 ms, 9 ms                                                                                             |
| Memory in use                                                                      | 200 MB when empty, 247 MB with the large history, 313 MB under sustained load, flat over 3 minutes     |
| Sustained load: 6 concurrent clients, 3 minutes, mixed reads, previews, and grades | 24,831 requests (about 140 a second), 0 server errors, median 20 ms, 95th percentile 29 ms, 99th 34 ms |
| Start to healthy                                                                   | 0.6 s empty, 1.0 s with the large history                                                              |
| Online backup while studying                                                       | 0.4 s, passes `integrity_check`                                                                        |
| Restore from that backup, to healthy                                               | 1.0 s                                                                                                  |

History size barely matters for what a learner does each day, because the queue reads indexed due dates and never scans the review log. The Statistics page reads the log, so it has its own measurement (next section).

## The Statistics page (measured 2026-10-17)

`npm run benchmark:stats` starts the production server on a free port, imports two decks of 1,500 cards, puts one in a folder, writes 100,000 review records straight into the database (90% study reviews and 10% practice answers over 240 days, about 375 study reviews a day, far more than one person does), schedules 80% of the items over the next 70 days, and times the Statistics requests. It exits with an error if the main request takes longer than 1 second.

| Request                                      | Median | 95th percentile |
| -------------------------------------------- | ------ | --------------- |
| `GET /api/stats` (every deck)                | 376 ms | 428 ms          |
| `GET /api/stats?deckId=` (one deck)          | 265 ms | 290 ms          |
| `GET /api/stats?folderId=` (one folder)      | 282 ms | 305 ms          |
| `GET /api/folders/:id/stats` (folder panel)  | 232 ms | 243 ms          |
| `GET /api/decks` (home screen, same history) | 27 ms  | 38 ms           |
| `GET /api/practice/pool`                     | 15 ms  | 25 ms           |

The response is about 10 KB. The script prints SQLite's plan for the three main queries: the review queries use `review_log_mode_time_idx` (mode, then time) and the forecast uses `card_state_phase_idx`, so there is no scan of the whole log and **no new index was needed**. The cost is reading about 90,000 review times to build the streak, the 14-day chart, and the heatmap. For a normal history of 100 reviews a day (36,000 a year) the page is well under 150 ms. If a history ever reaches millions of rows, the next step is a per-day summary table (ADR-017 names it as the way out).

## What is not measured yet

- Slow storage such as a network share. SQLite over NFS or SMB is not supported. Keep the data folder on a local disk or a Docker volume.
