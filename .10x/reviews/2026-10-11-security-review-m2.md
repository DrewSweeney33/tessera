# Security Review: Tessera Milestone 2 exit

**Date:** 2026-10-11
**Phase:** 5 Verification, Milestone 2 exit. Repeats the M1 interim review (`2026-10-11-security-review.md`) and covers what M2 added.
**Feature slug:** `tessera-v1`
**Commit reviewed:** `1884089` on `main` (CI green on `ad454a0`)
**Method:** the controls in ADR-005, ADR-009, ADR-010, and ADR-011 were read against the code, then tested against the **built production server** with adversarial requests (`scripts/security-probe.ts`, now 215 checks, run in CI on Linux), and the new browser-side surface (highlighting, diagrams) against the hostile-content corpus on three browser engines. Mutation checks were used on the new security logic (see the QA report). Findings below were reproduced, not inferred.

## Summary

| | M1 | M2 |
|---|---|---|
| Critical | 0 | 0 |
| High | 0 | 0 |
| Medium | 2 open | **0 open** (both closed) |
| Low | 3 | 3 open or accepted (S-04, S-10, S-11) |
| Info | 4 | 4 |

**Both M1 medium findings are closed and verified, and nothing new above Low was found.** The DNS rebinding gap (S-01) is fixed by a default host check, and the API token design conflict (S-02) was resolved by ADR-011 and is enforced and tested. The new attack surface (a second deck parser, code highlighting, diagrams, the release pipeline, the container image scan) holds up under adversarial tests. Two residual points are not vulnerabilities but things a user must understand; they are in "What the token does and does not do".

## Status of the M1 findings

| ID | M1 verdict | Now | Evidence |
|---|---|---|---|
| S-01 DNS rebinding not blocked | Medium, open | **Closed** | Default rules answer `localhost`, any IP address, single-word names, and `.local`, `.lan`, `.home.arpa`, `.internal`, `.localdomain`. Real domain names get 421 until `TESSERA_ALLOWED_HOSTS` is set. Probe: 5 rebinding services and lookalikes (`attacker.example`, `127.0.0.1.nip.io`, `7f000001.c0a80001.rbndr.us`, `localhost.evil.com`, `tessera.lan.evil.com`) refused with 421 and **no deck data in the refusal**; writes refused too; `/healthz` stays open for the Docker health check; the startup log states the rules; the refusal says how to fix it. Mutation checks caught: every dotted name allowed, substring wildcard, suffix match, loosened IPv4 range. |
| S-02 Token would lock out the UI | Medium, open decision | **Closed** by ADR-011 | See below. |
| S-03 Oversized chunked body gave 500 | Low, fixed | Still fixed | Probe and unit tests |
| S-04 Four moderate advisories in dev tooling | Low, accepted | Accepted, unchanged | `drizzle-kit` pulls an old `esbuild` dev server; never started; absent from the image (the image has no npm and no dev dependencies). `npm audit --omit=dev`: 0. |
| S-05 Image never built or scanned | Low, open | **Closed** | CI builds both architectures, runs the image as the non-root user, applies the size budget, and scans amd64 with Trivy; the scan gate fails on any high or critical finding that has a fix and prints which. The first scan failed (undici, tar, ip-address, brace-expansion inside the base image's npm, corepack, yarn); the runtime image now deletes those and the scan passes (Debian 13.7 and Node.js libraries, no fixable high or critical). |
| S-08 `docs/security.md` missing | Info, open | **Still open** | ADR-005 still points to a file that does not exist. See "Needs the owner". |

## What the token does and does not do (S-02 resolution, tested)

With `TESSERA_API_TOKEN` set (at least 24 characters, refused at start-up otherwise, constant-time comparison on digests):

- **A plain script, `curl`, or any caller that does not pretend to be the web page** needs `Authorization: Bearer <token>` on every `/api/*` route except `/api/schema`. Probe and integration tests: missing, wrong, and right token; wrong scheme and odd spacing; lowercase `bearer`.
- **Path tricks do not get around it.** `/%61pi/decks`, `/ap%69/decks`, and `/api/%64ecks` (which the router decodes) are refused (probe and browser test).
- **A hostile web page cannot use it.** A page on another site cannot send the web page's marker header (a custom header needs a CORS preflight, and the preflight is never approved), cannot read the API, and cannot post a deck with a plain form (SvelteKit answers 403, and the token check would answer 401). Sec-Fetch-Site `same-site` (another port on the same host), `cross-site`, and `none` are not treated as the web page.
- **The web page keeps working with a token set**, on loopback and over plain HTTP on a LAN address (where browsers send no `Sec-Fetch-Site`). The browser test checks that premise on the wire: every call from the page carries the marker and none carries `Sec-Fetch-Site`.
- **The token is not in the page or its scripts** (browser test searches the HTML and every script).

**What it does not do, and the documents say so:** the token is not a login. The marker header is not secret, so anyone who can reach the port and reads the source can send it, and the web page itself has no authentication. Anyone who can open the page on your network can use it. The deployment guide and the changelog both say to keep it behind a VPN or a reverse proxy that asks for a password. I recommend keeping that wording prominent in the README quickstart (see "Needs the owner").

## New surface in M2

| Area | What was tested | Result |
|---|---|---|
| **Markdown deck parser** | Same deck in JSON and Markdown gives the same import (property test). YAML alias bomb, 100,000 nested brackets, unknown and custom YAML tags in the front matter: all clean client errors, fast (probe). Indented label inside a choice is an error, not silent text. Unicode abuse, BOM, line endings. | Pass |
| **Syntax highlighting (Shiki, JS regex engine, no WASM)** | CSP unchanged: `script-src 'self'`, no `unsafe-eval`, no `wasm-unsafe-eval`. Highlighted code is built from DOM nodes with `textContent`; no HTML string is ever parsed, so hostile code (HTML, script tags, long lines, odd Unicode) can only be text. | Pass on three engines |
| **Diagrams (Mermaid 12.1.0)** | `securityLevel: 'strict'`, HTML labels off, result sanitized by DOMPurify **and** shown as an image whose content is inert. Hostile diagram corpus: script and image tags in labels, `javascript:` links, `click` handlers, `style` and `classDef` with remote URLs, and **new this review**: KaTeX math labels using `\href{javascript:}`, `\url`, `\htmlClass`, `\includegraphics`, `\htmlData`, `\htmlStyle`. The diagram draws; the SVG contains no `javascript:`, no foreign host, no script, no event handler; nothing ran and no foreign request was made. | Pass |
| **Hostile Markdown corpus** | 20 payloads, each sanitizer layer alone, 22 raw HTML strings. Disabling DOMPurify fails 23 tests. | Pass on Chromium, Firefox, WebKit |
| **Typed and choice cards** | Typed answers are compared by shared code (`core/typed-match.ts`); the suggested grade is only a suggestion and the learner can override it, so a matcher bug cannot cost progress. Choice order is a seeded shuffle with no secret in it (it is not a security control). | Pass |
| **Release pipeline** | Workflow permissions are `contents: read` by default; only the release job has `contents: write` and `packages: write`. Every action is pinned to a commit SHA with a version comment (Trivy v0.36.0 included). Release runs the full CI first. No untrusted pull request value goes into a shell command (checked by test). Release assets are built by a reproducible script; the zip writer refuses unsafe paths, duplicate names, and a version that is not plain `x.y.z`; checksums are verified with `sha256sum -c` and a separate `unzip -t`. Dependabot covers npm, Docker, and Actions. | Pass by reading and tests. **Not run on a tag** (R-11). |
| **Container image** | Non-root `node` user, read-only root and `cap_drop: ALL` and `no-new-privileges` in compose, loopback-only publish, health check without curl, `.dockerignore` keeps `.git`, `.env`, `*.db`, `.10x`, tests out. **npm, corepack, and yarn removed from the runtime image**, so there is no package manager in the container to abuse. | Pass in CI. Compose hardening read and policy-tested, not run on a real host. |
| **Secrets** | Pattern scan of every tracked file for private keys, GitHub tokens, cloud keys, chat tokens: nothing. History scan for private keys: nothing. No `.env` or key files tracked. The token is read from the environment only and never logged (probe searches the whole log). | Pass |
| **Logs** | A unique marker sent as card text and as a typed answer never appears in the server log. | Pass |
| **Availability** | 300 concurrent requests, malformed HTTP, and a four-minute soak (54,338 requests, four workers, 692 re-imports) with no error lines, no crash, and flat memory. | Pass |

All 215 probe checks pass on the built server (Windows locally, Linux in CI). There are no known-open entries left in the probe.

## Findings

### S-10 (Low, accepted): KaTeX prototype pollution advisory through Mermaid

`npm audit` lists GHSA-238p-pmpm-9mq7 (KaTeX: existing prototype pollution can bypass trust restrictions) under `katex`, reached through `mermaid` (a direct dependency, pinned at 12.1.0). It is **not** in `npm audit --omit=dev` because Mermaid is bundled into the browser build rather than installed in the image. It matters only if something else has already polluted `Object.prototype` in the page, and then only for KaTeX's optional "trust" features, which Mermaid does not enable. I tested the actual risk: math labels using every KaTeX trust feature (`\href`, `\url`, `\htmlClass`, `\includegraphics`, `\htmlData`, `\htmlStyle`) produce an inert image with nothing executable or remote in it, under `securityLevel: 'strict'`, and the test is now part of the browser suite. **Accepted.** The audit's suggested fix is a downgrade to Mermaid 10.8.0, which would lose diagram types and is not worth it. Revisit when Mermaid ships a release with a patched KaTeX.

### S-11 (Low, open, one-line fix): no log rotation in `compose.yaml`

The server writes one log line per request. Docker's default log driver keeps everything forever. At normal use (a few hundred requests a day) that is kilobytes a day, so this is unlikely ever to matter, but a runaway client or a monitor polling every second could slowly fill a small disk, and disk-full is the one failure this project has not tested (R-7). **Recommendation:** add `logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }` to the service in `compose.yaml` and one sentence in `docs/operations.md`. Not changed: this is a settings change that needs the owner's approval.

### S-12 (Info): arm64 image is built and run in CI but not scanned

The scan runs on amd64 only. Both architectures are built from the same npm packages and the same Debian release, so findings differ only for architecture-specific Debian packages. Acceptable; revisit if a scan finding ever appears only on arm64.

### Informational (carried over)

| ID | Note |
|---|---|
| S-06 | `style-src 'unsafe-inline'` is a documented, accepted risk (ADR-005). Script execution stays locked down. |
| S-08 | `docs/security.md` is still missing and ADR-005 promises it. See "Needs the owner". |
| S-09 | No rate limiting. Acceptable behind a proxy for a single-user tool. The soak served about 225 requests a second without trouble. |
| S-13 | The first-line startup log states the host rules, which is intended. It would name `TESSERA_ALLOWED_HOSTS` entries in the log, which are host names, not secrets. |

## What was not verified

- The release workflow's tag path (registry push, release creation, attached assets, provenance and SBOM). The pieces are tested, and the CI half runs on every push, but the tag half has never run.
- `packages: write` is allowed by the repository settings. Unknown until a real tag.
- Compose hardening on a real host, and graceful shutdown through `docker compose stop`.
- Behaviour when the disk fills (R-7).
- Anything involving a real person using the app on an untrusted network. The threat model assumes loopback, a VPN, or a password-protecting proxy.

## Verification plan

| When | What |
|---|---|
| Done at this exit | 215 probe checks in CI on Linux, hostile corpus on three engines, image scan, mutation checks on the new security logic, secrets scan, KaTeX payloads |
| Before the `v0.1.0` tag | Owner: rehearse the release on a branch, check workflow permissions, decide S-11 and S-08 |
| M3 | Add every new route (export, settings, leech actions) to the probe; run the XSS corpus through export output if it renders anywhere |
| M5 exit | Final review: repeat this pass, re-scan the image, review dependency changes since 0.1.0 |

## Needs the owner

- [ ] **S-08:** write `docs/security.md` (the threat model in plain words, what the token does and does not do, the host rules, backups) or amend ADR-005 to point at the README and deployment guide. I can draft it on request.
- [ ] **S-11:** approve the log-rotation setting in `compose.yaml`.
- [ ] Accept or reject S-10 (the Mermaid and KaTeX advisory) and S-04 (the `drizzle-kit` dev advisories).
- [ ] Read "What the token does and does not do" and confirm that is how you want the README to describe it.
