# QA and security: Milestone 7 (safe on the network), 2026-10-18

**By:** QA Engineer and Security Engineer roles. **Scope:** the optional page password (`TESSERA_PASSWORD`, ADR-021: the login page, the cookie, the guard on every page and API route, `/api/auth/*`, Sign out and Sign out everywhere, the slow-down on wrong guesses), the backup limit (`TESSERA_MAX_BACKUPS`, `409 backup_limit`, the Backups page), and the oversized chunked body fix (backlog B-3).

**Result:** no blocking findings. Three small defects found by testing, all fixed. One new accepted risk (S-19) and four from ADR-021 recorded as known limits (S-20 to S-22 and the note on plain HTTP). S-11, S-12, S-14, S-15 are closed or reduced when the password is on; S-16 stays by design. Not verified: a real phone, a password manager filling the form, Firefox on this machine (it cannot launch here; CI runs it), and a turned-on password on the live instance (the owner chooses the password, so CT123 runs with sign-in off).

## What was tested

| Part | Tests | Planted bugs |
|---|---|---|
| Cookie, key, password check, wrong-guess delay, `next` path (pure functions) | 33 unit in `tests/unit/foundations/auth.test.ts` (and the config rules in `config.test.ts`) | see the planted-bug pass below |
| The guard and `/api/auth/*` through the real hook chain: unsigned, wrong token, forged and damaged cookies, flags, `Secure` only behind an HTTPS proxy or an HTTPS Origin, cookie writes must look like the page, renewal after 30 days, Sign out and Sign out everywhere, the counter persisted and kept out of the settings, the slow-down and the cap of 20 waiting attempts | 29 integration in `auth.test.ts`, 3 in `auth-off.test.ts` | the same pass (it ran all four auth test files together) |
| Every route: the list of routes the app has must equal the list in `auth-routes.test.ts`; every API route and method is refused without a login except six named ones, reached with one; every page redirects; an unknown page also redirects | 8 integration | a temporary undecided route failed the test as intended |
| The login in a browser: redirect and return (with the query kept), a wrong password, show and hide, `next` cannot leave the site, an already signed-in visit, the delay explanation, 320 px with 44 px controls, accessibility in both themes (with and without the error), Sign out, Sign out everywhere (asks first), a second device sent to the login on its next request, what a script or a stranger can reach, the cookie flags | 15 e2e in `sign-in.spec.ts` (Chromium and WebKit) | |
| Backup limit: at, below, and above the limit, safety copies not counted, a hand-named `manual-` file counted, a failed write takes no place, delete frees one, download and delete unaffected | 9 integration, 5 e2e (including accessibility in both themes) | |
| Body reader: a body a little over the limit is read to its end before the 413, an endless one is cut off after 1 MB, a stream that fails while draining | 3 new unit tests (12 in the file) | |
| Probe | 906 checks (normal mode) and **955 in `--password-mode`**: the whole existing suite signed in (cookie and token) plus a new sign-in section that sends no credentials, plus the chunked 20 KB body to every small-limit route; `probe:remote-check` passes | |

Totals: unit 1,352, integration 1,022, the full Chromium suite **383 tests** (6.6 min, after the last code change), the sign-in spec on WebKit (15 of 15) and the settings and layout specs on WebKit, `security:probe` 906 and 955 checks with no failure, `probe:remote-check`, `ops:check`, `eslint`, `svelte-check`, `prettier` all clean.

**Planted-bug pass.** Twenty-three deliberate breaks of the sign-in code: the counter not checked, the signature not compared, future-dated cookies accepted, no `HttpOnly`, no renewal, the delay never starting, no cap on waiting attempts, a success not clearing the count, a changing request needing no page look, any bearer token accepted (aimed at `authGuard`, after a first try landed in the older token guard by mistake), pages not redirected, Sign out everywhere left open, `/api/schema` open for every method, a failure not counted, no wait, the guess written to the log, no counter bump, no login needed to sign out everywhere, `Secure` never set, `//` allowed in `next` (an equivalent mutant: the check after it refuses `//host` too, so the line is defense in depth), the login page allowed as `next`, a password check that always passes, the counter ignored. **22 of 23 caught; the 23rd is equivalent.**

## Defects found by testing, fixed

1. **A 2 KB login body reset the connection** instead of getting its 413. This was backlog B-3 showing itself on a new route (the probe sends bodies without a declared length). Fixed for every small-limit route by reading and discarding up to 1 MB more before answering; tested at the function level and against a real server on 14 routes.
2. **The spec and ADR said the third wrong guess waits; the code, tests, probe, and guide say the fourth.** Three wrong guesses are answered at once, the fourth waits 0.5 s. The behaviour is the intended one (a typo or two never costs time); the ADR and spec text were corrected to say "after three".
3. **The probe's first draft of the sign-in section asserted too much:** a DELETE sent with a body (Node answers 400 before the app), a Location that merely contained the typed host name inside an encoded `next`, and a form-typed login that SvelteKit's own origin check turns into 403 before the content-type rule (415). The expectations were corrected; none was a defect in the app.

Not defects but worth knowing: Playwright's WebKit reports a `SameSite=Lax` cookie as "None", so that one assertion is skipped on WebKit (the header is checked by the integration test and the probe); Firefox cannot launch on this machine (CI runs it).

## Security review

**New surface:** `/login`; `GET /api/auth/status`; `POST /api/auth/login`, `/logout`, `/logout-all`; a cookie; the `409 backup_limit` and the counts in `GET /api/backups`; the 1 MB drain on oversized bodies.

- **The gate is the API, not the pages.** The pages redirect to the login for convenience. The data comes only from `/api`, and every API route is closed unless named in `isOpenWithoutSignIn`. The every-route test fails the build if a route is added without being listed, and if any open route is not in its table.
- **The login cookie** is `v1.<counter>.<time>.<HMAC-SHA256>` with a key derived from the password (scrypt), so it needs no session table, survives restarts, cannot be made without the password, and changing the password signs every device out. The signature is compared in constant time; any malformed, over-long, wrong-version, wrong-counter, future-dated, or wrong-key value is refused (tested with twelve variants over HTTP, including a forged first cookie followed by the real one).
- **The password** is checked with scrypt and a per-process salt, compared in constant time, never logged (tested against the real log with the password, the wrong guesses, and every cookie value), never in a URL, never in an error. A wrong answer says only that it is wrong, whatever the length.
- **Guessing.** Wrong guesses are slowed (0.5 s, 1, 2, 4, up to 30 s), counted across everyone because behind a proxy there is no address to count, and the right password waits the same, so there is no lockout to abuse. At most 20 attempts wait at once; the 21st gets 429 with `Retry-After`. A success clears the count. Timing was measured against the real server (first three at once, fourth about 0.5 s, fifth about 1 s, right password after wrong ones about 2 s, then quick again).
- **A cookie is sent by the browser on its own,** so a signed-in request that changes data must also look like the Tessera page (same-origin by `Sec-Fetch-Site`, a matching `Origin`, or the page marker), otherwise 403. This is a third lock behind `SameSite=Lax` and the JSON content-type rule. Tested with no sign, cross-site, same-site, another Origin, and `Origin: null`.
- **The API token still works for scripts** and is checked first; it does not open a page, and it is not enough for Sign out everywhere (that needs a login). With a password set and no token, only the browser can use the API (the guide says to set both).
- **`Secure` follows what the proxy or the browser says** (`X-Forwarded-Proto: https`, or an `Origin` that starts with `https://`), never the server's own idea of its scheme: a cookie marked `Secure` on a plain-HTTP address would be dropped and sign-in would silently not stick.
- **`next`** is always a path on this site and never the login or the API (tested with nineteen bad values, and in a browser with `//evil.example`, an absolute URL, `/login`, `/api/decks`).
- **Off means off.** With no password, `app.auth` does not exist; no redirect, header, cookie, or log difference except the startup line `sign-in: off`; the status route says so and the other routes answer 404. The whole existing probe (906 checks) runs in this mode.
- **Backups.** The limit counts only `manual` backups; the safety copies are never counted, refused, or deleted; the count is read from the folder each time, so a failed write takes no place and a hand-named `manual-` file counts. Nothing is ever deleted by Tessera. The refusal is before any write and says what to do.

**Residual risks (accepted):**

- **S-19 (new): a copied login cookie survives a one-device sign-out** until Sign out everywhere or a password change. That is the price of "until I sign out" without a server-side list of devices (the owner's choice). The Security section says so in one sentence, and the guide says what to do about a lost device.
- **S-20 (new): a restore from a backup older than a Sign out everywhere can lower the counter,** so a cookie revoked before that backup could work again. Changing the password closes it. Recorded in the guide; a restore is rare and owner-initiated.
- **S-21 (new): the password is in the compose file,** readable by anyone who can read it (the owner chose this; the API token already lives there). A forgotten password is one edited line.
- **S-22 (new): wrong guesses from a stranger slow the owner's own sign-in** (up to 30 s per attempt while the attack lasts), because the count is global. They never lock the owner out, a signed-in device is never affected, and the delay ends 15 minutes after the guessing stops. A per-address count would be useless behind a proxy.
- **Plain HTTP:** over a plain `http://` address the password travels unencrypted and the cookie cannot be `Secure`. The guide says to use the HTTPS address or a VPN.

**Re-stated against the new controls:**

| Risk | Was | Now |
|---|---|---|
| S-11 anyone who reaches the page can do anything | accepted (ADR-005) | **closed when `TESSERA_PASSWORD` is set**; still true when it is not (the default) |
| S-12 repeated Back up now can fill the disk | accepted | **closed**: at most `TESSERA_MAX_BACKUPS` (default 10) manual backups, the 11th is refused before it writes. The safety copies are shown with their size but not limited |
| S-14 a Statistics request costs time in proportion to the history | accepted | needs a login when the password is on; otherwise unchanged |
| S-15 practice answers can be added without limit | accepted | needs a login when the password is on; otherwise unchanged |
| S-16 static files answer under any host name | accepted by design | unchanged: they hold no data, adapter-node serves them before any hook |
| B-3 oversized chunked bodies get a reset | open | **fixed** |

## Deployed

CT123 runs `tessera:library-fe7d813-m7b` (slice A deployed first as `-m7a`), with **sign-in off** and `TESSERA_MAX_BACKUPS: 50` (the host already held 18 manual copies from deploys; nothing was deleted). Verified by request: 12 routes 200, `/api/auth/status` says off, the login route is a 404 with no cookie, `GET /api/backups` reports 19 of 50 manual and 14 safety copies (12.6 MB), a 20 KB chunked body to a small route is a `413` with an answer, 31 decks, 1,100 cards, 1 folder, 11 in Trash unchanged, no log warnings. Nothing was graded, answered, or backed up on the live data by the checks. Rollback: `compose.yaml.before-m7b.bak` (and `...before-m7a.bak`); no migration in either slice, so the data volume needs no restore.

## Release readiness

Ready to release with Milestone 6 (0.3.0 is the honest number: a new optional feature, a new setting, and new routes; the owner decides, and tags). The owner's own checks: choose a password and put it in the password manager (it never goes in a note), turn sign-in on at a quiet moment, and do the phone pass in `docs/phone-checklist.md` (sign in on the phone, let the password manager fill it, Sign out, Sign out everywhere from the other device). CI runs all three browsers on the commit.
