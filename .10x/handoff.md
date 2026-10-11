# Handoff

## Current handoff

**From:** SDE, Milestone 2 (M2-11, diagrams and code highlighting)
**To:** The owner (approve the push), then the SDE for M2-12
**Date:** 2026-10-11
**Per-feature files:** `.10x/decisions/sde/tessera-v1.md` (section "M2-11"), `.10x/adrs/010-diagrams-and-code-highlighting-under-the-csp.md`

### Result

Code fences are highlighted and `mermaid` fences are drawn, with the Content-Security-Policy unchanged. Both libraries are dev dependencies and load only for a card with a code fence. Gates are in the SDE log.

### State of git

M2-05 to M2-10 are on GitHub. M2-11 is committed locally and **not pushed**. It adds two dependencies (Mermaid 12.1.0 and Shiki 4.5.0, MIT) and about 1,900 lines to `package-lock.json`, so it needs the owner's approval.

### Next

1. Owner: approve pushing M2-11. Try a real deck with a diagram and a code block in both themes.
2. M2-12 API token (ADR-009), M2-13 Claude skill, `docs/deck-format.md` (say which languages are highlighted and which diagram types were checked), golden decks, M2-14 e2e for everything plus Firefox and WebKit (diagrams and highlighting were only run in Chrome), M2-16 gate (QA, security review, `v0.1.0` only after approval, image scan).

### Things to know

- Diagram text is part of an image: not selectable, fixed system font. The source sits under "Diagram source".
- Cisco IOS style configuration has no grammar, so it shows as plain code.
- `npm audit` lists a low `katex` advisory through Mermaid and an `esbuild` one through `drizzle-kit` (the second predates M2-11). `npm run audit:prod` finds 0.
- The app has no favicon, so each first page load gets a 404 for `/favicon.ico`. Harmless, worth fixing.
- Earlier open items are unchanged (compose wrappers unverified on a real host, registry push unexercised, disk-full and long soak untested, Firefox, Safari and screen readers untested).

## Handoff history

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
