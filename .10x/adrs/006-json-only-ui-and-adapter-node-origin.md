# ADR-006: JSON-Only UI and Request Origin Under adapter-node 6

**Status:** Accepted
**Date:** 2026-10-10
**Feature:** tessera-v1
**Author:** 10x-Team (Architect + SDE)
**Supersedes:** the form-action and `ORIGIN` parts of ADR-005 section 3 and the `ORIGIN` mentions in ADR-004 and ADR-005

## Context

ADR-005 said the UI would submit through SvelteKit form actions, protected by SvelteKit's built-in origin check, and that `ORIGIN` would be set when running behind a proxy. While building the HTTP layer (M1-13) a smoke test against the real production build showed otherwise. Verified in the installed packages on 2026-10-10:

- `@sveltejs/adapter-node` 6.0.0 has **no `ORIGIN` setting**. Its supported variables are `SOCKET_PATH`, `HOST`, `PORT`, `XFF_DEPTH`, `ADDRESS_HEADER`, `PROTOCOL_HEADER`, `HOST_HEADER`, `PORT_HEADER`, `BODY_SIZE_LIMIT`, `SHUTDOWN_TIMEOUT`, `IDLE_TIMEOUT`, `KEEP_ALIVE_TIMEOUT`, `HEADERS_TIMEOUT`.
- Without `PROTOCOL_HEADER`, it assumes the protocol is `https`. A direct `http://192.168.x.x:3000` visit therefore has a request origin of `https://...`.
- SvelteKit 3 rejects a mutating request with 403 ("Cross-site POST form submissions are forbidden") when its content type is missing or is a form type (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`) and its `Origin` header differs from that derived origin. Observed: a same-origin `http` POST with a matching `Origin` header still gets 403.
- Requests with `Content-Type: application/json` are not subject to that check.
- `BODY_SIZE_LIMIT` defaults to 512K, below Tessera's 5 MB import limit (confirmed working at `5M`).

So form actions would fail for the most common self-hosted setup, plain HTTP on a trusted network, unless the user also runs a proxy that sets forwarding headers.

## Decision

1. **The UI uses JSON `fetch` calls only.** No SvelteKit form actions and no remote functions in v1. Every mutation is a `POST`, `PUT`, `PATCH`, or `DELETE` to `/api/*` with `Content-Type: application/json` (or `text/markdown` for import).
2. **Protection for JSON endpoints stays as in ADR-005:** the content-type guard (415 otherwise), no CORS headers ever, and the optional API token. A cross-site page cannot send `application/json` without a CORS preflight that the server never approves. SvelteKit's own check remains as defense in depth for form-type requests and answers 403 before the app sees them.
3. **Remove `ORIGIN` from Tessera's configuration.** It was never read by the adapter.
4. **Document the proxy variables.** Behind a TLS-terminating reverse proxy, set `PROTOCOL_HEADER=x-forwarded-proto` and `HOST_HEADER=x-forwarded-host` so SvelteKit's view of the request URL is correct. This is not needed for the JSON-only UI to work, but keeps any future form handling and absolute URLs right.
5. **`BODY_SIZE_LIMIT=5M` is set in the Dockerfile and compose file.** The app logs a warning in production when it is unset (already implemented).

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Keep form actions and require the proxy headers | Uses SvelteKit idioms, progressive enhancement | Breaks plain-HTTP LAN installs, the primary use case. Easy to misconfigure. | Fails the "one `docker compose up`" goal. |
| Default `PROTOCOL_HEADER=x-forwarded-proto` in the image | Works behind a proxy out of the box | With no proxy the header is absent and the protocol falls back to `https` again | Does not fix the direct-access case. |
| Set `csrf.trustedOrigins` | Official escape hatch | Build-time, and the deployment origin is unknown at build time | Not possible for a published image. |
| Disable the origin check | Would make forms work everywhere | Removes a real protection | Unacceptable for an app with no login. |
| Custom Node entry that rewrites the protocol | Full control | Fragile, ongoing maintenance, forks the adapter's behavior | Over-engineering when JSON fetch avoids the problem. |

## Consequences

### Positive

- Works on plain HTTP, behind any proxy, and on `localhost`, with no origin configuration.
- One request style for the whole UI, the same one Claude tooling uses.
- Fewer SvelteKit features to learn and test. Remote functions and form actions are explicitly out of scope.

### Negative

- Forms are not progressively enhanced: the UI requires JavaScript. Already true (`ssr = false`, ADR-005).
- A future need for real HTML form posts (file upload through a plain form) would have to use `fetch` with a `File` body or revisit this decision.

### Risks

| Risk | Mitigation |
|---|---|
| A developer adds a form action later and it fails on HTTP | Lint rule is not practical. The staff-engineer conventions and docs state "JSON fetch only", and the smoke test covers form-type refusal. |
| A cross-site page tricks a browser into a `fetch` with `application/json` | Impossible without a preflight, and no CORS headers are sent. The smoke test asserts the preflight gets no allow headers. |
| A proxy strips or rewrites the `Content-Type` | The request then fails with 415, a visible and safe failure. |

## Dependencies

- Refines ADR-005 (security posture) and ADR-004 (container environment). Constrains the UI tasks M1-16, M1-19, and M2-10: all use `fetch`.
