# ADR-005: Security Posture Without Login

**Status:** Accepted. Section 3 (form actions and `ORIGIN`) is superseded by ADR-006.
**Date:** 2026-10-10
**Feature:** tessera-v1
**Author:** 10x-Team (Architect + Staff Engineer)

## Context

The user chose a single-user app with no login. Access control is the job of a reverse proxy or VPN. That decision moves several risks to the application boundary:

- A page on any website can make the victim's browser send requests to a LAN service at a private address (LAN CSRF) or use DNS rebinding to reach it.
- Card content comes from an LLM or the internet and is rendered as Markdown, code, and Mermaid diagrams, so it is untrusted input to a browser.
- An import endpoint accepts large structured text, which invites resource exhaustion.
- Optional API access from scripts needs some protection without a login system.

## Decision

### 1. Network exposure

- No built-in user authentication. Documentation states this plainly in the README quickstart and in `docs/security.md`.
- The sample `compose.yaml` publishes only on loopback (`127.0.0.1:3000:3000`). Exposing it to the LAN is an explicit edit, with a warning comment.
- `ORIGIN` (adapter-node) must be set to the public URL when behind a proxy. This makes SvelteKit's origin check meaningful.
- Optional `TESSERA_ALLOWED_HOSTS` (comma-separated). When set, requests whose `Host` header is not listed receive `421 Misdirected Request`. This defends against DNS rebinding. Unset by default, with a startup log line recommending it.

### 2. API token

- Optional `TESSERA_API_TOKEN`, minimum 24 characters (boot fails otherwise).
- When set, **every `/api/*` route except `/healthz` and `/api/schema`** requires `Authorization: Bearer <token>`. This refines the spec, which listed only write routes, because exports, backups, and the weak-spot report expose study data.
- Comparison uses `crypto.timingSafeEqual` on equal-length digests.
- The browser UI does not use the token. It relies on same-origin protections below and on the proxy.

### 3. Cross-site request protection

- UI form submissions use SvelteKit form actions with the built-in origin check.
- JSON endpoints require `Content-Type: application/json` exactly and reject anything else with `415`. A cross-site page cannot send that content type without a CORS preflight, and **no CORS headers are ever emitted**.
- State-changing routes accept only `POST`, `PUT`, `PATCH`, `DELETE`. `GET` handlers never change state.

### 4. Rendering untrusted content

- Markdown is rendered **client-side only**, in one component, `src/lib/ui/Markdown.svelte`, using `marked` (18.x) with raw HTML tokens escaped, followed by `DOMPurify` (3.x) sanitization. Links are limited to `http`, `https`, `mailto`, and relative URLs, and get `rel="noopener noreferrer"`.
- Code highlighting uses Shiki loaded lazily in the browser. Its HTML output also passes through DOMPurify.
- Mermaid (12.x) is loaded lazily for cards containing a `mermaid` fence and initialized with `securityLevel: "strict"`. Its SVG output passes through DOMPurify's SVG profile.
- The app runs with `ssr = false` globally. Card content never needs server-side HTML rendering, so no DOM emulation library (jsdom) is needed on the server.
- ESLint rule `svelte/no-at-html-tags` is on everywhere. The single exemption is `Markdown.svelte`.

### 5. Content Security Policy and headers

Set in `src/hooks.server.ts` with SvelteKit's `kit.csp` in auto mode:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self'; font-src 'self';
object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

Plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. Whether Mermaid and Shiki run under this policy without additional relaxation is a **verification item for M2**. If not, the exception is recorded in a superseding ADR and kept minimal.

### 6. Input hardening

- Body limit 5 MB (`BODY_SIZE_LIMIT=5M` plus an explicit check in the import route).
- Card count, field length, tag count, and choice count limits from ADR-002.
- YAML frontmatter parsed with the `yaml` package using the core schema, no custom tags, `maxAliasCount: 10`.
- All SQL goes through Drizzle's parameterized API. No string-built SQL.
- Fetching external URLs is out of scope, so there is no server-side request forgery surface in v1.

### 7. Logging and data handling

- Structured JSON logs to stdout. Logs never contain card content, typed answers, or the API token.
- The only persisted data is the SQLite file under `DATA_DIR`. No telemetry, no external calls.

### 8. Dependency and supply chain hygiene

- Exact version pins and a committed lockfile.
- CI runs `npm audit --omit=dev` and a license check allowing MIT, Apache-2.0, ISC, BSD, and MPL-2.0 (for DOMPurify's dual license), failing on others. Dependabot is enabled for npm, Docker, and GitHub Actions.
- GitHub Actions are pinned to commit SHAs.

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Built-in password login | Safe on a bare LAN | Sessions, password storage, reset flows, rate limiting: a large surface for a single-user tool | User chose no login. Revisit if multi-user is ever added. |
| HTTP Basic Auth from env vars | Tiny to implement | Browsers cache credentials awkwardly, still needs HTTPS, duplicates what the proxy does better | The proxy is the right layer. |
| Bind to `127.0.0.1` inside the container | Safe by default | Makes the container unreachable through Docker port publishing | Loopback publish on the host achieves the same without breaking Docker. |
| Server-side rendering of Markdown with `isomorphic-dompurify` | SSR content and faster first paint | Requires jsdom on the server, larger image, more attack surface | Client-only rendering is simpler and sufficient. |
| Skip the token and rely only on the proxy | Less config | Script users (Claude tooling) have no protection if the port is exposed | An optional token is nearly free. |
| Full CSP without `'unsafe-inline'` styles | Stricter | Svelte transitions, Mermaid, and Shiki rely on inline styles | Accepted risk, scripts remain locked down, which is the XSS-critical directive. |

## Consequences

### Positive

- Safe defaults: loopback publish, strict content types, sanitized rendering, locked-down CSP for scripts.
- The documented trust model is honest: Tessera does not claim to protect an exposed port.
- No session or password code to get wrong.

### Negative

- Anyone who can reach the port can read and change everything (unless the proxy or token intervenes). This is inherent to the chosen model.
- The UI cannot use the API token, so a token-protected API plus an open UI still depends on the proxy for the UI.
- `style-src 'unsafe-inline'` is weaker than ideal.
- `ssr = false` means no content before JavaScript runs. Acceptable for a private study tool.

### Risks

| Risk | Mitigation |
|---|---|
| User exposes the port to the internet without auth | Loopback default, bold README warning, startup log warning when `TESSERA_ALLOWED_HOSTS` is unset, docs showing a proxy example. |
| Mermaid or Shiki break under the CSP | Verify in M2, fall back to the narrowest documented relaxation. |
| DOMPurify bypass in a future version | Dependabot, exact pin, a test suite of known XSS payloads run against the Markdown component. |
| Malicious deck crafted to exhaust the browser (huge diagram) | Per-field length limits, Mermaid render timeout and error badge on failure. |

## Dependencies

- Depends on ADR-001 (SvelteKit hooks and CSP support), ADR-002 (limits and YAML handling), ADR-004 (loopback publish, hardened runtime flags, `ORIGIN`).
