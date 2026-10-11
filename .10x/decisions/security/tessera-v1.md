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
| S-01 | Medium | DNS rebinding not blocked by default. `TESSERA_ALLOWED_HOSTS` is parsed but not enforced, and the promised startup warning is missing. | **Open.** Do first in M2. Safe default: reject dotted public host names, allow loopback, IPs, and single-label or `.local`, `.lan`, `.home.arpa`, `.internal` names. |
| S-02 | Medium | The API token as specified in ADR-005 would lock the UI out, since the UI calls the same routes. Not enforced yet. | **Open decision.** Recommend: token for external clients only, same-origin browser requests exempt, and only after S-01 ships. Amend ADR-005. |
| S-03 | Low | Oversized chunked body gave 500 | **Fixed** (`readBodyText`) |
| S-04 | Low | 4 moderate advisories in dev tooling via `drizzle-kit` and old `esbuild` | **Accepted**, dev only, not in the image |
| S-05 | Low | Image never built or scanned. Base image pinned by tag. Action SHAs unchecked until CI runs. | **Open**, M2-15 |
| S-06 to S-09 | Info | `unsafe-inline` styles accepted. CSP loosening was not caught by `verify` (now the probe runs in CI). `docs/security.md` missing. No rate limiting. | Noted |

## Decisions made in this pass

1. The security probe and the durability check are permanent and run in CI. New routes must be added to the probe.
2. The probe reports documented-but-unbuilt controls as KNOWN, not PASS and not FAIL. Closing one flips it to PASS.
3. No code change to the threat posture was needed beyond S-03. S-01 and S-02 are scheduled, not patched here, because they are M2-12 scope and S-02 needs the owner's decision.

## Handoff

SDE: S-01 first, S-02 after the owner decides, `docs/security.md`. DevOps: GitHub remote, first CI run on Linux, image scan.
