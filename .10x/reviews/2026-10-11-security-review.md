# Security Review: Tessera Milestone 1 (interim)

**Date:** 2026-10-11
**Phase:** 5 Verification, interim. Final review is at the M5 exit. A security review is also required at the M2 exit.
**Feature slug:** `tessera-v1`
**Commit reviewed:** `bb53e77`
**Method:** read the controls in ADR-005 against the code, then tested each control against the **built production server** with adversarial requests (`scripts/security-probe.ts`, 102 checks, now part of CI). Findings below were reproduced, not inferred.

## Summary

| | |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 (1 open design gap, 1 open design decision) |
| Low | 3 (1 fixed, 2 accepted or tracked) |
| Info | 4 |

**The controls that ADR-005 promises and that exist today all work.** The two medium findings are about controls that are **designed but not built yet** (host check) or **designed in a way that conflicts with the UI** (token). Neither is exploitable on a default install except through DNS rebinding, which needs a hostile web page open in the same browser as Tessera.

## System and trust boundaries

Tessera is a single-user web app with no login. SvelteKit with adapter-node serves a client-rendered UI and a JSON API. Data is one SQLite file. The container publishes the port on loopback only.

| Boundary | Untrusted input crossing it | Controls |
|---|---|---|
| Network to server | Any HTTP request from anything that can reach the port, including web pages the owner visits | Loopback publish, JSON-only content type guard, SvelteKit origin check, no CORS, body limits, strict validation |
| Deck file to database | Text written by an LLM or found on the internet | Strict schema, limits, parameterized SQL, content hashing |
| Database to browser | Stored card text, rendered in the owner's browser | Markdown renderer with raw HTML disabled, DOMPurify, link allow-list, CSP |
| Build to runtime | npm packages, base image, CI actions | Exact pins, lockfile, install scripts off, audit and license gates, Dependabot |

**Assets:** the owner's review history (the valuable part, weeks of effort), deck content (low sensitivity, mostly study material), availability of the app. No credentials, no personal data beyond what the owner types into cards, no payment data.

**Adversaries, ranked by likelihood:** (1) a malicious or careless deck, from an LLM or a shared file, containing hostile Markdown; (2) a hostile web page open in the owner's browser (CSRF, DNS rebinding); (3) another device on the LAN if the owner widens the port mapping; (4) a compromised dependency; (5) the owner's own mistakes (exposing the port, pasting the wrong file). Targeted attackers are out of scope for a personal study tool.

**Worst realistic case:** a hostile page rewrites or archives the owner's decks, or a hostile deck runs script in the Tessera origin and does the same. Impact is data loss or tampering, not disclosure of anything sensitive. Backups limit it.

## Controls verified against the running server

| ADR-005 control | Test | Result |
|---|---|---|
| Section 5: CSP with `script-src 'self'`, no `unsafe-inline` or `unsafe-eval` for scripts, `frame-ancestors 'none'`, `object-src 'none'` | Header checked on `/` and a 404 | Pass |
| `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` | Checked on five routes | Pass |
| No CORS headers ever, including a real preflight | `OPTIONS` with `Origin` and `Access-Control-Request-*` | Pass: no approval emitted |
| `Cache-Control: no-store` on `/api` | Checked | Pass |
| No cookies, no `Server` or `X-Powered-By` | Checked on five routes | Pass |
| Section 3: JSON-only mutating routes | Six wrong or missing content types, each tested **two ways**: cross-origin, where SvelteKit's own check answers 403, and same-origin, where our guard alone answers 415 | Pass: both layers work independently |
| State changes only on POST, PUT, PATCH, DELETE | `GET /api/import`, `GET /api/study/review` | Pass: 405 |
| Section 6: 5 MB body limit | 6 MB with `Content-Length`; 6 MB chunked with no length | Pass after fix (see S-03) |
| Deep nesting | 500,000 nested brackets | Pass: clean 4xx, server stays up |
| Prototype pollution | `__proto__` and `constructor.prototype` in a deck and in a review | Pass: rejected, nothing polluted |
| SQL injection | Card ids, card text, and `deckId` values with quotes, `%`, `_`, `OR '1'='1`, NUL, 500 characters, `../` | Pass: clean 400, 404, or stored inert. Tables intact. |
| Dangerous query flag values | `dry_run=yes`, empty, `TRUE`, `2` | Pass: refused with 400, so an unexpected value never becomes an unintended real import |
| Unicode abuse | NUL, lone surrogate, bidi override, ZWJ emoji family | Pass: round-trips or is refused cleanly |
| Algorithmic complexity | Pathological cloze markers and Markdown emphasis runs | Pass: handled in under 3 s total, server responsive |
| Path traversal on static files | Six encodings (`..%2f`, `%2e%2e`, backslash, double) | Pass: nothing leaked |
| Error leakage | Malformed URL, bad JSON, wrong shapes, array query parameters, unknown route | Pass: no paths, stack traces, or framework dumps |
| Section 7: logs never hold card content or typed answers | Unique marker sent as card text and typed answer, then the full server log searched | Pass |
| Request id header cannot carry attacker content | Hostile id sent | Pass: replaced |
| Availability | 300 concurrent requests; malformed HTTP on a raw socket | Pass: all served, process alive |
| Section 4: hostile Markdown | 20-payload corpus in Chrome, each of the two sanitizer layers on its own, 22 raw hostile HTML strings | Pass (earlier work). Disabling DOMPurify now fails 23 tests. |
| Section 8: dependencies | `npm audit --omit=dev`: 0. License check: 12 packages allowed. No install scripts run. Exact pins everywhere. No secrets in the tree or in any commit. | Pass |
| Container hardening (read, not run) | Non-root `node` user, read-only root, `cap_drop: ALL`, `no-new-privileges`, `tmpfs /tmp`, loopback publish, health check, `.dockerignore` keeps `.git`, `.env`, `*.db`, tests out | Looks right. **Not executed** (no Docker). |

## Findings

### S-01 (Medium, open): DNS rebinding is not blocked by default

**What:** a request with a foreign `Host` header (`Host: attacker.example`) is answered normally. `TESSERA_ALLOWED_HOSTS`, which ADR-005 section 1 specifies to return 421 for this, is parsed from the environment but not enforced. ADR-005 also promises a startup log line recommending it when unset; that line does not exist.

**Attack:** the owner has Tessera running on `127.0.0.1:3000` and visits a hostile page. The page's domain is re-pointed from the attacker's server to `127.0.0.1`. The browser now treats requests to the attacker's domain as same-origin with Tessera's API, so the page can read all decks and progress and send JSON imports (including `archive_missing`). Our CSRF and content-type guards do not apply because the request is same-origin from the browser's view.

**Likelihood:** low. It needs the attack page open at the time, a browser that does not block it, and the attacker to know or guess the port. **Impact:** tampering with or deleting study data, and reading it. No code execution. A backup restores it.

**Reproduced:** yes (`scripts/security-probe.ts`, check "foreign Host header", reported as KNOWN).

**Recommendation:** make this the **first** task of M2 rather than M2-12. A safe default needs no configuration: when `TESSERA_ALLOWED_HOSTS` is unset, accept `localhost`, loopback addresses, other IP literals, and single-label or `.local`, `.lan`, `.home.arpa`, `.internal` names, and reject other dotted public names with 421. That blocks rebinding (which needs a public domain) without breaking LAN use. A reverse proxy deployment sets the variable explicitly. Add the startup warning. Flip the probe check from KNOWN to PASS.

### S-02 (Medium, open decision): the API token as specified would lock out the UI

**What:** ADR-005 section 2 says that when `TESSERA_API_TOKEN` is set, every `/api/*` route except `/healthz` and `/api/schema` requires the bearer token. ADR-005 also says the browser UI does not use the token. The UI calls those same routes, so enabling the token as written breaks the app.

**Not a vulnerability today:** the token is parsed but not enforced, and the README lists it as reserved. It is a design defect that would become a broken feature or a bad workaround (exempting the UI by guessing it is a browser).

**Recommendation:** decide before M2-12. Preferred: the token protects **external clients only** and is documented as such; the reverse proxy or VPN protects the UI. Implementation: browser requests are recognised by `Sec-Fetch-Site: same-origin` plus a matching `Host` (set by browsers and not forgeable by page script), and everything else needs the token. This exemption is only safe **together with S-01**: a DNS-rebound page also looks same-origin to the browser, and only the host check stops it. Ship S-01 first. Amend ADR-005. Alternative: a login for the UI, which the owner rejected.

### S-03 (Low, fixed): an oversized chunked body returned 500

**What:** a body over the limit sent with chunked transfer encoding made the adapter throw from the stream, which surfaced as a 500 and an "unhandled error" log entry. No crash and no memory growth, but a wrong status and a noisy log.

**Fix:** `src/lib/server/http/body.ts` (`readBodyText`) enforces the byte cap itself, stops reading at the limit, maps the adapter's error to 413, and counts bytes (the review route compared characters). Covered by 10 unit tests, the probe, and a mutation check.

### S-04 (Low, accepted, tracked): four moderate advisories in dev tooling

`npm audit` reports 4 moderate findings, all reached through `drizzle-kit`, which pulls an old `esbuild` with a dev-server issue (GHSA-67mh-4wv8-2f99: any website can send requests to the esbuild dev server). `drizzle-kit` is a dev dependency used to generate migrations, the esbuild dev server is never started, and the production image runs `npm prune --omit=dev`. The audit's suggested "fix" is a downgrade. **Accepted.** CI gates on `--omit=dev`. Revisit when `drizzle-kit` ships a release that drops the old esbuild.

### S-05 (Low, open): the container image has never been built or scanned

The Dockerfile uses the tag `node:24-trixie-slim`, not a digest, and no vulnerability scanner runs on the image. Dependabot watches the Docker ecosystem. **Recommendation:** add an image scan (for example Trivy) to the release pipeline in M2-15 and consider a digest pin there. The four GitHub Action SHAs in the workflow could not be checked offline and will be validated by the first CI run; Dependabot keeps them current.

### Informational

| ID | Note |
|---|---|
| S-06 | `style-src 'unsafe-inline'` is a documented, accepted risk (ADR-005). Script execution stays locked down. Card content cannot inject styles because DOMPurify removes `style` attributes and tags, tested. |
| S-07 | A mutation check showed that loosening the CSP `script-src` was not caught by any test in `verify`. The probe now runs in CI, which closes it. |
| S-08 | ADR-005 refers to `docs/security.md`, which does not exist. The README covers the posture today. Write it before v0.1.0 or amend the ADR. |
| S-09 | No rate limiting. Acceptable for a single-user tool behind a proxy. 300 concurrent requests were served without trouble. |

## Verification plan

| When | What |
|---|---|
| Now (done) | `npm run security:probe` (102 checks) in CI. `npm run durability` in CI. |
| First M2 task | Host check and startup warning (S-01). Probe check flips to PASS. |
| Before M2-12 | Decide S-02, amend ADR-005, then probe: missing, wrong, and right token; same-origin UI still works with a token set; the schema and health endpoints stay open. |
| M2-11 (Mermaid, Shiki) | Prove they run under the CSP without relaxing `script-src`; run the XSS corpus through both, including SVG payloads. |
| M2 exit | Repeat this review. Add: image scan, a Linux run of the probe, a test that the server refuses to start with a bad `TESSERA_API_TOKEN`. |

## Hardening checklist handed to the SDE

- [ ] Default host allow-list and startup warning (S-01)
- [ ] Token design decision, then enforcement with constant-time comparison (S-02)
- [ ] Write `docs/security.md` or amend ADR-005 (S-08)
- [ ] Keep the probe in CI and add every new route to it

## Handed to DevOps

- [ ] Create the GitHub remote and read the first CI run, including the Docker jobs and the new probe and durability steps on Linux
- [ ] Add an image scan to the release pipeline
