# Handoff

## Current handoff

**From:** SDE, Milestone 2 (M2-12, the API token)
**To:** The owner (approve the push), then the SDE for M2-13
**Date:** 2026-10-11
**Per-feature files:** `.10x/decisions/sde/tessera-v1.md` (section "M2-12"), `.10x/adrs/011-recognizing-the-web-page-for-the-api-token.md`, `.10x/adrs/009-api-token-for-external-clients-only.md`

### Result

`TESSERA_API_TOKEN` is enforced. The web page works without it, on loopback, on a network address over plain HTTP, and over HTTPS. Scripts need `Authorization: Bearer`. Other websites cannot reach the API through a visitor's browser. The deployment guide, README, compose file, and changelog describe it, including what it does not do.

### State of git

M2-05 to M2-11 are on GitHub. M2-12 is committed locally and **not pushed**.

### Needs the owner

1. **Approve the push.**
2. **Read the "what it does not do" paragraph** in `docs/deploy.md` ("The API token"). The token does not protect the web page, and a script that copies the browser headers gets in. That is inherent without a login and is what ADR-009 decision 6 said, but ADR-009's wording suggested more. Say if you want the guide to read differently, or if you want a stronger design (it would need a login, which was ruled out).
3. Try it once on the homelab: set a token, open the page from another device by its address, check `curl` with and without the header.

### Next

M2-13 Claude skill, `docs/deck-format.md` (also say which languages are highlighted and which diagram types were checked), golden decks. Then M2-14 (e2e for everything plus Firefox and WebKit), M2-15 release pipeline (publication needs approval), M2-16 gate (QA, security review, image scan, `v0.1.0` only after approval).

### Things to know

- Testing against a real built server and a real browser found two faults that every unit test passed (the scheme `adapter-node` assumes, and what browsers send on plain HTTP). Keep doing that for anything that depends on headers.
- A reverse proxy with HTTP Basic authentication cannot pass the token through (same header). Documented.
- `playwright.config.ts` now starts two servers (ports 4177 and 4178). Stray servers from manual testing can hold the ports.
- The app has no favicon, so each first page load gets a 404. Harmless.
- Earlier open items are unchanged (compose wrappers unverified on a real host, registry push unexercised, disk-full and long soak untested, Firefox, Safari and screen readers untested, diagrams and highlighting only run in Chrome).

## Handoff history

### 2026-10-11: SDE, M2-11, to the owner

Diagrams and code highlighting under the unchanged policy (ADR-010). See the SDE log section "M2-11".

### 2026-10-11: SDE, M2-09 and M2-10, to the owner

Import preview detail and the typed and choice study screen. See the SDE log section "M2-09 and M2-10".

### 2026-10-11: SDE, M2-05 to M2-08, to the owner

Markdown deck format (reader, writer, detection, import route and page). Property tests and a 66-bug mutation check. See the SDE log section "M2-05 to M2-08".

### 2026-10-11: DevOps Engineer and SRE, Phase 6 Delivery (readiness of the M1 slice), to the owner and the SDE for M2

Delivery package for M1 (deploy, operations, release docs, release workflow, ops check) and four reliability fixes (ADR-008). Conditional sign-off for the owner's own use. GitHub setup, M2-00 (host check), ADR-009 (API token) decided and done after this handoff. Details in `.10x/decisions/devops/tessera-v1.md` and `.10x/decisions/sre/tessera-v1.md`.

### 2026-10-11: QA Engineer and Security Engineer, Phase 5 interim verification, to SDE, DevOps, and the owner

The M1 slice was sound. Two defects fixed (no h1 on the study screen, oversized chunked body gave 500). 14 of 15 injected bugs caught by the tests; the survivor (CSP loosening) is now covered by the security probe in CI. Two medium security items scheduled: S-01 DNS rebinding as new task M2-00, S-02 token versus UI as an owner decision. Reports in `.10x/reviews/2026-10-11-qa-report.md` and `2026-10-11-security-review.md`.

### 2026-10-10: SDE, end of Milestone 1, to the next session

All 23 M1 tasks done and verified. Backend, UI ("Tessera Desk" design), 20 browser tests, README and docs, benchmark, and CI steps in place. Decisions recorded: ADR-006 (JSON-only UI), ADR-007 (install scripts off), ADR-003 refinement (learn-ahead is a last resort), fonts as static files, `theme-init.js` for no flash, located JSON syntax errors.

### 2026-10-10: SDE, mid-Milestone 1, to the next session

16 of 23 tasks done: the whole backend (schema, parser, import, scheduler, queue, submitReview, routes, container, CI). UI tasks, e2e, benchmark, and docs remained.
