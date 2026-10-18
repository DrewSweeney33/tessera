# Security Decisions: tessera-v1

**Date:** 2026-10-11
**Phase:** 5 Verification, interim (M1 slice). Full audit: `.10x/reviews/2026-10-11-security-review.md`

## Threat model (summary)

Single-user app, no login, one SQLite file, port published on loopback. The valuable asset is the owner's review history. Likely adversaries, in order: hostile Markdown in a deck, a hostile web page in the owner's browser (CSRF, DNS rebinding), another LAN device if the port is widened, a compromised dependency, the owner's own mistakes. Worst realistic case is tampering with or deleting study data. Nothing sensitive is stored.

## Verified controls

Everything ADR-005 promises that exists today was tested against the built server: CSP and security headers, no CORS, two independent CSRF layers, JSON-only mutations, body limits (including chunked), strict validation, prototype pollution, SQL injection attempts, path traversal, error hygiene, log hygiene, request id handling, availability under 300 concurrent requests, malformed HTTP. Two-layer Markdown sanitization verified in Chrome and in unit tests. 101 probe checks pass.

## Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| S-01 | Medium | DNS rebinding not blocked by default. `TESSERA_ALLOWED_HOSTS` was parsed but not enforced, and the promised startup log line was missing. | **Fixed 2026-10-11 (M2-00).** Default rules answer localhost, IP addresses, single-word names, and `.local`, `.lan`, `.home.arpa`, `.internal`, `.localdomain`. The setting replaces the name rules (IP addresses and localhost always work) and accepts `*.domain` and `name:port`. Refusal is 421 with the fix in the message. `/healthz` exempt. Startup log states the rules. 140 probe checks, none open. |
| S-02 | Medium | The API token as specified in ADR-005 would lock the UI out, since the UI calls the same routes. Not enforced yet. | **Decided 2026-10-11 by the owner: ADR-009.** Token for external clients only, same-origin browser requests exempt, and only after S-01 ships. Builds in M2-12. |
| S-03 | Low | Oversized chunked body gave 500 | **Fixed** (`readBodyText`) |
| S-04 | Low | 4 moderate advisories in dev tooling via `drizzle-kit` and old `esbuild` | **Accepted**, dev only, not in the image |
| S-05 | Low | Image never built or scanned. Base image pinned by tag. Action SHAs unchecked until CI runs. | **Open**, M2-15 |
| S-06 to S-09 | Info | `unsafe-inline` styles accepted. CSP loosening was not caught by `verify` (now the probe runs in CI). `docs/security.md` missing. No rate limiting. | Noted |

## Decisions made in this pass

1. The security probe and the durability check are permanent and run in CI. New routes must be added to the probe.
2. The probe reports documented-but-unbuilt controls as KNOWN, not PASS and not FAIL. Closing one flips it to PASS.
3. No code change to the threat posture was needed beyond S-03. S-01 and S-02 are scheduled, not patched here, because they are M2-12 scope and S-02 needs the owner's decision.

4. **2026-10-11, M2-11 (ADR-010):** Mermaid and Shiki run under the unchanged policy. Diagrams are shown as images through data URIs, so a hostile diagram cannot run script, load resources, or restyle the page. Highlighted code is text nodes only. The browser tests send hostile diagram text and code and check for violations, dialogs, outside requests, and injected elements. Open: a low severity `katex` advisory through Mermaid (dev only, not in the production audit), and a hostile but within-limits diagram that is slow to lay out has not been searched for.

5. **2026-10-11, M2-12 (ADR-009, ADR-011): S-02 closed.** The API token is enforced for callers that are not the web page. Found by running a real browser: the rule in ADR-009 would have locked the page out over plain HTTP, so it was refined. Stated plainly: the token does not protect the web page, and a client that copies the browser headers is accepted. Protection of the page is the proxy or the VPN. Open: no lockout for repeated guesses, token cannot pass through a Basic-auth proxy.

## Handoff

SDE: S-01 first, S-02 after the owner decides, `docs/security.md`. DevOps: GitHub remote, first CI run on Linux, image scan.

## M6 security notes (2026-10-18)

New routes: `POST /api/study/undo`, `POST /api/practice/undo`; changed: `POST /api/practice/start` (`tag`, `quiz`), `GET /api/practice/item`. All behind the host check, JSON content-type rule, cross-site guard, and API token (ADR-009), strict Zod bodies, review id regex, probe checks for wrong methods, bad bodies, `__proto__`, unknown fields, and the token rule. No new accepted risk beyond S-11 (anyone who can reach the page can already grade, so they can undo); Milestone 7 closes that class. The quiz builder reads only the owner's own cards and sends nothing anywhere. The one accepted edge is in ADR-019 (a delayed duplicate answer after an undo).
