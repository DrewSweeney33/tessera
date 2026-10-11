# ADR-009: The API token covers external clients only

**Status:** Accepted. Supersedes ADR-005 section 2 ("API token").
**Date:** 2026-10-11
**Feature:** tessera-v1
**Author:** 10x-Team (Security Engineer + Architect), decided by the owner

## Context

ADR-005 section 2 says that when `TESSERA_API_TOKEN` is set, every `/api/*` route except `/healthz` and `/api/schema` requires `Authorization: Bearer <token>`. The same ADR says the browser UI does not use the token. The UI calls those same routes, so turning the token on as written would lock the UI out of its own API. The security review of 2026-10-11 recorded this as finding S-02. The token is parsed but not enforced yet, and the README lists it as reserved.

Tessera has no login. The person who runs it protects the UI with a VPN or a reverse proxy that asks for a password (see `docs/deploy.md`). The token exists for scripts and tools such as Claude tooling that call the API from outside the browser.

## Decision

1. **The token protects external clients.** When `TESSERA_API_TOKEN` is set, a request to `/api/*` (other than `/healthz` and `/api/schema`) is accepted only if it carries the correct bearer token, **or** it is a same-origin request from the Tessera web app itself.
2. **A same-origin browser request** is one that the browser marks `Sec-Fetch-Site: same-origin`, or, where that header is missing, whose `Origin` header equals the origin of the request. Browsers set these headers themselves and page script cannot forge them.
3. **Everything else needs the token**, including scripts, `curl`, other tools, and cross-site browser requests. A cross-site page cannot ride on the user's browser to reach the API, which is a second layer on top of the content-type guard and the origin check.
4. **Comparison is constant time** (`crypto.timingSafeEqual` on equal-length digests), as in ADR-005. A wrong or missing token gets 401.
5. **Ships only after the host check.** A page that uses DNS rebinding is, to the browser, same-origin with Tessera, so the same-origin exemption would let it through. The allowed-hosts check (task M2-00, security finding S-01) must be in place first. The startup log warns when a token is set and the host check is not active.
6. **The UI is still protected by the proxy or the VPN, not by the token.** The documentation says so plainly, so nobody believes the token locks the interface.

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Token required for everything, UI included (as ADR-005 reads) | Simple rule | The UI has no token and cannot get one without a login | Breaks the app. |
| A separate path prefix or port for the UI | No header sniffing | Doubles the routing, breaks the simple one-port deployment | Too much machinery for one optional setting. |
| A built-in login for the UI | Real access control on a bare LAN | Sessions, password storage, reset flows, rate limiting | The owner rejected a login in the first design decision. |
| Remove the token | Less to build | Scripts get no protection when the port is shared | An optional token is nearly free. |
| Exempt requests that merely look like browsers (by `User-Agent`) | Easy | Trivially forged by any script | Not a control. |

## Consequences

### Positive

- The setting works as people expect: scripts need the secret, the UI keeps working.
- Cross-site pages cannot call the API through a visitor's browser, token or not, once a token is set.

### Negative

- A browser too old to send `Sec-Fetch-Site` and also not sending `Origin` on a GET (Safari before 16.4) would be treated as external and could not use its own UI when a token is set. Documented. Current browsers are fine.
- The same-origin rule is only as strong as the host check beside it (decision 5).
- A user who sets a token may believe the UI is locked. The deployment guide and the startup log say it is not.

### Risks

| Risk | Mitigation |
|---|---|
| A reverse proxy strips or rewrites `Sec-Fetch-Site` or `Origin` | Tested through a proxy configuration in the M2 verification. Documented. If the headers are lost the UI is treated as external, which fails closed. |
| Same-origin exemption bypassed by DNS rebinding | Host check first (decision 5), and a probe check that a rebound `Host` is refused even with a token set. |

## Dependencies

- Requires M2-00 (host check) before M2-12 (token enforcement).
- Tests for M2-12: no token set (open, as today), missing, wrong, and right token, UI requests with same-origin headers, a cross-site request, a request with no `Sec-Fetch-Site` and a matching `Origin`, the open endpoints stay open, and the probe covers each.
