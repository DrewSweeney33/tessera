# ADR-021: An optional page password

**Status:** Accepted by the owner on 2026-10-18 (design conversation for Milestone 7: "In the compose file", "Until I sign out", "Refuse, and say delete one first", then "Approved, go").
**Date:** 2026-10-18
**Feature:** tessera-v1 (Milestone 7)
**Author:** Claude (Architect + Security Engineer)
**Spec:** `.10x/specs/2026-10-18-milestone-7-safe-on-the-network-design.md`

## Context

ADR-005 chose no login: a single owner, a home network, and a reverse proxy or VPN in front for anything wider. ADR-009 and ADR-011 added an API token for scripts and exempted the web page itself, because a page that held a secret could not keep it from a script that copied what it sent. That left five accepted risks that all come from the same fact (S-11: anyone who can reach the page can do anything; S-12 and S-15: unbounded writes; S-14: an expensive read; S-16: static files under any host name). Reaching the page is the only thing standing between a stranger and the owner's database. The owner wants a login that can be turned on, without giving up the simplicity of the container.

Facts that shape the decision:
- There is one user and one secret. No accounts, no recovery email.
- The container is configured through environment variables in a compose file the owner already edits (the API token, the allowed hosts).
- The database has a `settings` table of key-value rows that is not shown to the user except for the known setting keys.
- adapter-node serves the built client files and `static/` before any request hook runs; they carry no data. The page is a client-rendered app that gets all of its data from `/api`.
- The reverse proxy (NPM) terminates HTTPS and every request reaches the server from the proxy's address.

## Decision

1. **The password is an environment variable**, `TESSERA_PASSWORD` (12 to 200 characters), off when unset. Not stored in the database, not changeable in the web page.
2. **The login is a signed cookie, with no server-side session table.** `tessera_session` = `v1.<epoch>.<issued>.<HMAC-SHA256>`, `HttpOnly`, `SameSite=Lax`, `Secure` when HTTPS is in use, 400 days and renewed after 30. The key is derived from the password with scrypt and a fixed context string, so it is stable across restarts and **changes when the password changes (which signs every device out)**. A counter, the epoch, kept in the existing `settings` table under `auth.sessionEpoch`, is bumped by **Sign out everywhere**; a cookie with a different epoch is refused. Sign out on one device only clears that device's cookie.
3. **The password is checked with scrypt and `timingSafeEqual`.** Wrong guesses are **slowed, never locked out**: after three wrong guesses in 15 minutes the next answer waits 0.5 s, then 1, 2, 4, up to 30 s (corrected on 2026-10-18 from "the third", which the code never did: the first three are answered at once), counted across all callers (the proxy hides who is who), the right password waits the same time, at most 20 attempts wait at once, and success clears the count.
4. **The API check is the gate.** With a password on, every `/api` route needs either the API token (`Authorization: Bearer`, for scripts) or the cookie, except `/api/auth/status`, `/api/auth/login`, `/api/auth/logout`, and `/api/schema`. A cookie-authenticated request that changes something must also pass `isWebPageRequest`. Pages redirect to `/login` (a 303, with a validated `next`), and the client's request helper goes to the login on the 401 reason `sign_in_required`.
5. **A test lists every route and fails the build** if a route exists that has no decision.
6. **Backups:** `TESSERA_MAX_BACKUPS` (default 10) caps the manual ones with a 409 before anything is written; Tessera never deletes a backup itself.
7. **Oversized chunked bodies** are answered with a 413 after draining up to 1 MB of the rest, so the client sees the answer instead of a reset.
8. **No migration.**

## Alternatives Considered

| Alternative | Pros | Cons | Why not |
|---|---|---|---|
| Password set in the web page on first run, stored hashed in the database | Changeable without editing a file | A migration and a reset flow, the first visitor on a network can claim an unprotected install, and a forgotten password needs server access anyway | The owner chose the compose file |
| Server-side session table (a row per device) | Real per-device sign out, expiry, a list of devices | A migration, more code, and every restart or restore risks losing or resurrecting sessions | A signed cookie plus an epoch covers "until I sign out", Sign out everywhere, and a password change with no table |
| Sessions held in memory | Simple | Every restart, deploy, and restore signs the owner out of every device | Annoying on a phone, and deploys are frequent |
| A lockout after N wrong guesses | Familiar | A stranger can lock the owner out of their own app, and behind a proxy there is no address to lock | A growing delay makes guessing impractical without that |
| HTTP Basic auth in the reverse proxy only | Nothing to build | Not in Tessera's control, not testable here, no sign out, the owner asked for it in the app | Still available and documented, as a complement |
| A password but the API token keeps no role | One secret | Scripts and the Claude skill would need a cookie | Scripts keep the token |
| 30 days, renewed | Revocation by time | The owner chose "until I sign out" | Chosen against |

## Consequences

### Positive
- With a password on, a stranger who reaches the page can read and change nothing: S-11 is closed, and S-14 and S-15 need a login.
- Off by default, so nothing changes for anyone who does not turn it on, and the way back is deleting one line.
- No new table and no migration; sessions survive restarts and deploys.

### Negative
- One more secret in the compose file (like the token). Anyone who can read the compose file can sign in.
- A cookie copied from a device the owner signed out of *on that device only* keeps working until Sign out everywhere or a password change.
- Over the plain-HTTP LAN address the password travels unencrypted and the cookie cannot be `Secure`.
- A restore from an older backup can bring a lower counter back, so a cookie revoked before that backup could work again until the password is changed.

### Risks
- **Locking the owner out** by a typo in the compose file: mitigated by the setting being off when blank and by the recovery line in the guide.
- **A route added later and left open:** the every-route test fails the build until the route is decided.
- **A guard bug that lets a request through:** the probe runs the whole existing suite signed in and a new section signed out, and every route is tested both ways.

## Dependencies
- ADR-005 (security posture), ADR-009 and ADR-011 (the token and the web page exemption, which this tightens when a password is on), ADR-014 (backups).
- Constrains: anything that adds a route must be listed in the every-route test; a future multi-user design would replace this.
