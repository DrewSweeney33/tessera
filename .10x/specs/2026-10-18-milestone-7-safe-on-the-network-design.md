# Milestone 7 design: safe on the network (page password, backup limit, oversized bodies)

**Date:** 2026-10-18. **Status:** approved by the owner on 2026-10-18 ("Approved, go"). **ADR:** ADR-021 (an optional page password). **Estimate:** about 24 hours in three slices, each deployed to CT123 after a backup, the password left off on the live instance. **No migration** (the one new stored value is a row in the existing `settings` table).

## Why this, and why now

Tessera has no login by design (ADR-005): anyone who can open the page can use everything, including deleting a deck for good, deleting or restoring a backup, and downloading the whole database. The API token (ADR-009) only guards scripts, and the web page is exempt from it. That was fine behind an internal-only reverse proxy, and it is the root of five accepted risks: **S-11** (anyone who reaches the page can do anything), **S-12** (repeated Back up now can fill the disk), **S-14** (a Statistics request costs time in proportion to the history), **S-15** (practice answers can be added without limit), and **S-16** (static files answer under any host name). It is also why a stray visitor on the LAN, or a misconfigured proxy rule, would be a real problem. This milestone adds a login the owner can turn on, a limit on backups, and fixes the last known rough edge in body handling (B-3).

## Decisions made with the owner (2026-10-18)

1. **The password lives in the compose file**, as `TESSERA_PASSWORD`, next to the API token. Unset means no login, exactly as today. No password in the web page, no database change, a forgotten password is one edited line.
2. **A login lasts until the person signs out.** (The alternatives offered were 30 days renewed and 12 hours.) Sign out ends it on that device. **Sign out everywhere** ends it on every device. Changing the password also ends every login.
3. **At the backup limit, refuse.** At 10 manual backups (changeable) Back up now says to delete one first. Tessera never deletes a backup by itself. The safety copies Tessera makes before a delete, a restore, or a migration are not counted, and their total size is shown.
4. The design below, approved as presented.

## Slice A: the page password (about 14 hours)

**Turning it on.** `TESSERA_PASSWORD`: 12 to 200 characters (the same blank-is-unset rule as the other settings). The startup log says "sign-in is on" and never the password. Unset: nothing changes, not a header, not a redirect.

**What is protected (when it is on).** Every page and every `/api` route, except:
- `/login` (the page), `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/logout`;
- `/healthz` (version and database check only, for the Docker health check and monitors);
- `/api/schema` (the public deck format, as today);
- the app's own files (scripts, styles, fonts, icons, the manifest, the offline page), which the server hands out before any request hook runs and which contain no data (S-16, accepted by design).
The API check is the real gate. The pages redirect to the login for convenience, and the data only ever comes from the API.

**The session.** A cookie `tessera_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when the request came in over HTTPS, `Max-Age` 400 days (the longest browsers keep a cookie) and renewed when it is older than 30 days, so an active device never drops out. Its value is `v1.<epoch>.<issued>.<mac>`: a version, a counter, the time it was made, and an HMAC-SHA256 over those with a key derived from the password (scrypt, a fixed context string). So:
- it needs no session table and survives a restart;
- it cannot be forged without the password;
- **changing the password changes the key and signs everyone out**;
- **Sign out everywhere** adds one to the counter, kept as a row in `settings` (key `auth.sessionEpoch`, not one of the user-facing settings), and a cookie carrying an older counter is refused.
A device that copied a cookie before the person signed out *of that device only* keeps working until Sign out everywhere or a password change: that is the price of "until I sign out" without a server-side list of devices, and the Security section in Settings says so in one sentence.

**Signing in.** `POST /api/auth/login` with `{ "password": "..." }` (a strict body, 1 KB). The password is checked by scrypt with a per-process random salt and `timingSafeEqual`, so the time taken says nothing about how close a guess was. **Wrong guesses are slowed, never locked out:** after three wrong guesses in 15 minutes the next one waits half a second before it is answered (the first three are answered at once; corrected on 2026-10-18 from "the third"), the next one second, then 2, 4, up to 30, counted across everyone (behind a reverse proxy every client has the proxy's address, so a per-address count would be useless), and the correct password is checked after the same wait, so a stranger cannot lock the owner out and cannot go faster by guessing in parallel (at most 20 waiting attempts at once, more get a 429 at once). A right password clears the count. A wrong one is a 401 `invalid_password`, with no hint about the length or form. The count lives in memory.

**API token and scripts.** With a password on, the API token still works for scripts and Claude (the `Authorization: Bearer` header, no cookie). The exemption "the web page itself needs no token" now means "the web page needs the cookie". With a password on and no token set, only a signed-in browser can use the API (the guide says to set both).

**Cookie requests must look like the page.** A request that carries the cookie and changes something (POST, PUT, PATCH, DELETE) must also pass the same-origin test the token exemption already used (`isWebPageRequest`: `Sec-Fetch-Site: same-origin`, or a matching `Origin`, or the page's own marker header), otherwise 403. `SameSite=Lax`, the JSON content-type rule, and the absence of any CORS header already stop a cross-site page; this is the belt to those braces.

**Pages and the browser.**
- A navigation without a session is a 303 to `/login?next=<path>` (the path only, never a full address; `next` is checked to be a plain path on this site and never `/login` or `//`).
- The API answers 401 `unauthorized` with `details.reason: "sign_in_required"`. The web page's request helper sends the browser to the login on exactly that reason (and not on the token-missing 401).
- `/login`: the wordmark, a password field (`autocomplete="current-password"`, a Show password toggle, an error line that is announced, a Sign in button), no tab bar. It redirects to the app if the person is already signed in, and says "Sign-in is not turned on" with a link home when it is off.
- **Settings gets a Security section:** whether sign-in is on, **Sign out** and **Sign out everywhere**, and when it is off a plain sentence that anyone who can open this page can use it, with the way to turn it on.
- The service worker is unchanged: it never handles `/api`, caches only the offline page and two icons, and a signed-out device simply gets the login page from the network.

**What it is not.** Not multi-user, not password reset by email, not two-factor, not an account. Over the plain-HTTP LAN address the password travels unencrypted (the guide says to use the HTTPS address, and the cookie is only marked `Secure` where HTTPS is in use).

## Slice B: backup limit and the oversized chunked body (about 6 hours)

**Backup limit (S-12).** `TESSERA_MAX_BACKUPS` (a whole number from 1 to 1000, default 10). `POST /api/backups` ("Back up now") answers 409 `backup_limit` with a plain message when the number of backups of kind `manual` (the kind the button makes, and the kind any file named `manual-...` in the folder is listed as) has reached it, before anything is written. The safety copies Tessera makes itself (kinds `pre-delete`, `pre-restore`, `pre-migrate`, `pre-reset`) are not counted. `GET /api/backups` also reports the count, the limit, and the total size of the safety copies, and the Backups page shows them and disables the button at the limit. Nothing is deleted by Tessera. The owner's own `manual-before-...` copies that the deploy procedure makes in that folder are listed as manual backups and count, so the live instance, which already holds more than ten, gets `TESSERA_MAX_BACKUPS` raised at deploy (nothing is deleted).

**Oversized chunked bodies (B-3).** Today a body with no declared length that passes a small route's limit (16 KB) is cut off by cancelling the stream, which can end the connection while the client is still sending, so the client sees a reset instead of the 413. The fix answers 413 and then **drains up to 1 MB more** of the body (discarding it) before the connection ends, and past that cap it ends the connection. Every small-limit route is tested with a chunked body of 20 KB, and the probe stops needing a declared length to see a 413.

## Slice C: close-out (about 4 hours)

QA and security review (`.10x/reviews/2026-10-18-qa-and-security-m7.md`), the deployment guide (`docs/deploy.md`), `SECURITY.md`, the README, and the operations guide updated, the accepted risks S-11, S-12, S-14, S-15, and S-16 re-stated against the new controls (S-11 closed when the password is on, S-12 closed, S-14 and S-15 need a login, S-16 stays by design), the vault notes, and a deploy to CT123 with the password **off** (choosing it is the owner's, and it never goes in a note: it belongs in Bitwarden).

## Testing

- **Crypto and cookie rules, pure and tested:** `core` or `server/auth/` functions for the cookie value (make, parse, verify), the key derivation, the epoch check, the delay schedule, the `next` path check. Forged, truncated, reordered, empty, over-long, wrong version, wrong epoch, and wrong key values are all refused; a value made with another password is refused.
- **Guard, every route:** an integration test lists every route of the app and checks it is refused without a session when sign-in is on, and passes with one (a list that fails the build when a new route is added and not decided).
- **The login:** right and wrong passwords, the slow-down schedule (with an injected clock and sleep), the cap on waiting attempts, a body that is too large or the wrong shape, a cookie with the right flags, `Secure` only over HTTPS, Sign out and Sign out everywhere (the old cookie refused, the new one works), a password change (an old cookie refused).
- **Browser:** the redirect to the login and back to the page that was asked for, a wrong password, Sign out, Sign out everywhere in a second context, a 401 mid-session going to the login, accessibility in both themes, 320 px.
- **Probe:** the whole existing probe runs a second time against a server with a password set, signed in (every one of the 900 checks must hold), plus a new section for sign-in (every route refused unsigned, forged cookies, login behaviour, flags, the slow-down). The remote check still passes.
- Slice B: the limit (at, below, and above it; safety copies not counted; a failed write does not count), the count in the list, the page, and a chunked 20 KB body to every small-limit route answering 413 with no reset.

## Security and risks

| Risk | Mitigation |
|---|---|
| The owner locks themselves out | The setting is off by default, and removing the line and restarting turns it off. The guide says so in the first paragraph of the section |
| A password too weak to matter | 12 characters minimum, the guide says to use a generated one and keep it in the password manager; the slow-down makes online guessing impractical, and nothing in the app ever shows or logs it |
| The cookie value leaks | `HttpOnly` (no script can read it), `Secure` over HTTPS, never logged, never in a URL |
| A signed-out device's copied cookie still works | Sign out everywhere (or a password change) ends it; the Security section says so |
| A restore from an older backup lowers the counter | A cookie that was revoked before the backup was taken could work again after the restore. Changing the password (which changes the key) always closes it. Recorded, not fixed (a restore is rare and owner-initiated) |
| Brute force | Per-process slow-down growing to 30 s, capped concurrency, scrypt per guess (about 50 ms), constant-time compare. Not a lockout, so a stranger cannot lock the owner out |
| An API route added later and forgotten | The "every route" integration test fails the build until the route is listed with a decision |
| The login page itself | Plain text errors, no user enumeration (there is one password), the same response time for an unset-versus-wrong case does not apply (one password), strict body |

## Out of scope

Accounts or roles, password reset, two-factor, login from the Settings page (the password stays in the compose file), per-device session lists, a sign-in log page, rate limiting of the API for signed-in callers, and a limit on the safety copies Tessera makes (only shown).

## Next

Write the state files and build slice A. The password stays **off** on CT123 until the owner turns it on.
