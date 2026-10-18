# QA and security: Milestone 4 (Practice again, statistics, exam dates) and Milestone 5 (installable app), 2026-10-18

**By:** QA Engineer and Security Engineer roles. **Scope:** Practice again (`/practice`, `/api/practice/*`), the Statistics page and `GET /api/stats`, an exam date on folders and migration `0003_folder_exam_date`, the installable app (manifest, icons, service worker, offline page), and the release and CI changes made while cutting 0.2.0. **Release candidates reviewed:** `v0.2.0-rc.1` (`c991310`) and `v0.2.0-rc.2` (`5ea8f71`).

**Result:** no blocking findings. Three accepted risks (S-14, S-15, S-16) and six defects found by testing or by CI, all fixed. The live-image harness passes against rc.2 with `--expect-migration`. Not verified: a real phone and a screen reader (the owner's part, `docs/phone-checklist.md`), Firefox on the local machine, the 10 minute soak.

## What was tested

| Part | Tests | Planted bugs |
|---|---|---|
| Practice core (shuffle, weakest first, loop-back queue, summary, skip, saved-session parser) | 28 unit | 5 across core, server, and queue; all caught |
| Practice pool, item, grade, and the promise that no schedule or study number changes (compares `card_state`, `cards`, `decks`, `folders`, settings, review rows, queue counts, folder statistics, leeches, weak tags byte for byte) | 21 integration, 17 API | all caught |
| Layer lint that keeps practice code away from the review path | 1 test, 9 snippets | |
| Statistics maths (forecast, heatmap, heat level, weekday; study days, DST, the rollover hour) | 40 unit | 6, all caught (one needed a stronger test) |
| Statistics by scope, practice kept apart, the folder panel equals the page | 16 integration | |
| Exam date rules and API, migration `0003` upgrade and restore | 51 unit (folder rules), 7 API, 3 migration, 1 restore | 1 (a rename wiping the date), caught after the test was strengthened |
| Service worker rules (what it takes over, which caches it owns, build id, timeout) | 32 unit | 4 caught |
| Installable app in a real browser (registers, takes over, offline page, cache holds only the offline page and two icons, an API call is not answered from anywhere, older shell caches removed) | 11 e2e on Chromium and WebKit; the offline tests start their own server and stop it | 2 more (the worker taking over every request, the worker storing pages), both caught |
| Browser | Practice 11, Statistics 14, exam date 4; accessibility scans in both themes and 320 px for every new screen | |
| Probe | 93 + 67 + 61 checks (793 in all) | |
| Speed | 100,000 review records: `GET /api/stats` 376 ms median, no scan of the review log, no new index (`npm run benchmark:stats`, in CI) | |

Totals at the release candidate: unit 1,301, integration 903, full Chromium e2e 313, WebKit e2e passes the same specs, `security:probe` 793 checks with no failure, `probe:remote-check` passes.

## Live-image harness (the real Docker host, CT123)

| Run | Result |
|---|---|
| rc.1, `--expect-migration` | 105 passed, 1 failed, 1 skipped (140 s). The upgrade from 0.1.1 came through with the deck and its progress; the backup was made before the migration; 0.1.1 refused the upgraded database; putting the backup back brought 0.1.1 up again. The one failure was three probe checks for the installable app's files, which that image predates (the probe runs from the working tree) |
| rc.2, first two attempts | A connection reset in the probe (see defect 6), not the image |
| rc.2, `--expect-migration` | **106 passed, 0 failed, 2 skipped** (154 s): hardening, application tests over the network, backup and restore with the operations guide's commands, the library features, the upgrade with rollback, a hard kill and a graceful stop, a full disk |

## Defects found by testing and CI, fixed

1. **CI had been red on the WebKit job since the redesign** and no one looked (`d9484c9`, `0f2a837`, `a66a4d5`). axe read colours while a button was still fading. Each scan now waits for running animations. Lesson: check CI after every push, not only the local gates.
2. **Statistics race (Firefox):** a slow answer for the first load (every deck) could replace the numbers of the deck picked after it. Each request is numbered and only the latest is shown; a test holds the first answer back and fails without the fix.
3. **Clearing an exam date did nothing in Safari:** Safari cannot empty a date field by hand, and its own form validation then stopped Save without a word. The folder form has a Clear date button and is `novalidate` (the page checks the date itself).
4. **The service worker made WebKit skip `page.route()`:** with a worker active, a stubbed restore reached the real server, which really stopped, and every later test failed. Service workers are blocked in every spec except the installable app spec.
5. **The probe's burst check failed on Windows** (the OS refused 63 of 300 connections while a healthy server worked through the rest). A refused connection is retried; every request must still answer 200.
6. **The probe reset connections against the real container:** a static file answers a write at once and can close the connection while the client is still sending. The writes count a reset as refused, and the installable-app section uses a connection of its own for each request.

Also found while building: the Leeches page lists wrong typed answers from any log row with grade 1, so a wrong answer typed in practice can appear there (observation, documented); `%sveltekit.assets%` can render as an absolute address, so the manifest and icon links are root-relative; SvelteKit 3 has no `$service-worker` module (a worker uses `$app/service-worker` and `$app/manifest`, with its own tsconfig).

## Security review

**New surface:** `GET /api/practice/pool`, `POST /api/practice/start`, `GET /api/practice/item`, `POST /api/practice/grade`, `GET /api/stats`, `PUT /api/folders/:id` with `examDate`, and static files: `/manifest.webmanifest`, `/service-worker.js`, `/offline.html`, `/icons/*.png`.

- **API routes** sit behind the host check, the JSON content-type rule, the cross-site guard, and the API token, like every other route. Probe checks cover wrong methods, malformed and oversized bodies, `__proto__`, unknown fields, path and query abuse, and the token rule for each new route and for a path variant of it.
- **Practice cannot change a schedule.** The practice code may import only the read-only half of the scheduler, the state mappers, and named read functions plus `insertReviewLog` (ESLint `allowImportNames`, proven by a lint test). A test compares the whole study state before and after a looping session.
- **Practice answers are kept out of every study number** (daily limits, queue counts, retention, streak, leeches, weak tags, folder statistics); the Statistics page shows them on their own line.
- **Exam date:** exactly `YYYY-MM-DD`, a real calendar date from 2000 to 2200; anything else is a 422 that names the field and changes nothing. The 5,000 character and SQL and script cases are refused. The value is only ever bound as a parameter and shown as text.
- **Service worker:** it takes over only same-origin `GET` page navigations outside `/api`, shows a cached static page when the server cannot be reached, never stores or changes anything else, and its cache name carries the build and only its own prefix is ever deleted. The worker file is fixed: a page cannot register a different one, so a script injected into a page could not use it to persist (script injection is already blocked by the CSP and the sanitizing renderer, ADR-005 and ADR-010). The CSP needed no change.
- **Static files** are served by adapter-node before the request hooks, so they are not under the host check or the security headers (like `robots.txt` and the fonts). They hold nothing private. The offline page has no script and loads nothing from anywhere else; the probe checks that.

**S-14 (accepted risk): a Statistics request costs time in proportion to the history.** 376 ms at 100,000 review records, with the server on one thread, so someone who can reach the page and asks again and again can make it slow. Forty concurrent requests all succeed. It is the same class as S-11 and S-12: the page has no login, so it belongs behind a VPN or a proxy. The way out is a per-day summary table (ADR-017).

**S-15 (accepted risk): practice answers can be added without limit.** Each is one small log row (a body is limited to 16 KB), like a study answer, and a deck's rows go away with the deck. Same class as above.

**S-16 (accepted, by design): static files answer under any host name and carry no CSP header.** They are public files; the data is behind `/api`, which is guarded.

**Observation:** a release now asks GitHub whether CI passed on the tagged commit instead of running everything again. A commit that only changes `.10x/` does not start CI, so tagging one would be refused; tag the release commit.

## Release readiness

Ready for 0.2.0: no blocking findings, the upgrade chain (three migrations) is proven on the real host in both directions, and CI is green on the release commit. Still the owner's: the phone pass (install, offline, dark mode, screen reader), and the decision to tag.
