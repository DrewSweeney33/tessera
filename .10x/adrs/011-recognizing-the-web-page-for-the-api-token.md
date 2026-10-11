# ADR-011: How the server recognizes its own web page when an API token is set

**Status:** Accepted. Refines decision 2 of ADR-009 (the rest of ADR-009 stands).
**Date:** 2026-10-11
**Feature:** tessera-v1 (M2-12)
**Author:** 10x-Team (Security Engineer + Architect)

## Context

ADR-009 says that with `TESSERA_API_TOKEN` set, a request to the API needs the token unless it is a same-origin request from the Tessera page, recognized by `Sec-Fetch-Site: same-origin` or, where that header is missing, an `Origin` header equal to the server's origin.

Running a real browser against a real built server, on the machine's network address over plain HTTP (the usual homelab setup), showed that this does not work as written:

1. **Browsers send `Sec-Fetch-Site` only to HTTPS and localhost.** On `http://192.168.x.x` it is absent.
2. **A same-origin GET carries no `Origin` header.** Only other methods and cross-origin requests do.
3. **The server's own idea of its origin is wrong.** `adapter-node` assumes `https` when no `ORIGIN` setting is given, so `event.url.origin` was `https://…` for a plain HTTP server, and no browser `Origin` could ever equal it. The unit tests used `http://localhost` and did not see this.

The result for a user who sets a token: the web page's own GET requests (the deck list, the next card) would be refused, and its POSTs too. ADR-009 listed old Safari as the only affected browser. In fact every browser on plain HTTP is affected.

ADR-009 also describes the page-recognition headers as "cannot be forged". That is true of page script, not of a script run by someone on the network. Any non-browser client can send any header. This is inherent in a server with no login (the web page is public, so whatever it can do, a client that copies it can do), and it is why ADR-009 decision 6 says the page is protected by the proxy or the VPN. This ADR restates it so it is not lost.

## Decision

1. **Recognizing the page, in order.**
   1. If `Sec-Fetch-Site` is present, it decides: only `same-origin` counts. `same-site`, `cross-site`, and `none` do not, even if the headers below look right. A browser sets it and a page cannot change it.
   2. Otherwise, if `Origin` is present, it must be a plain `http` or `https` origin whose host and port equal the request's `Host`. **The scheme is not compared**, because of fact 3 and because the server speaks one scheme. `Origin: null` (a sandboxed page) does not count.
   3. Otherwise the request must carry the page's own marker header, `X-Tessera-Client: web`, which the web app adds to every API call.
2. **The marker is safe against other websites** because a page on another site cannot send a custom header without a CORS preflight, and Tessera never grants one (no `Access-Control-Allow-*` header is ever sent). A browser test and a probe check both that a preflight asking for the header is granted nothing and that a call carrying it never goes out.
3. **The path is judged the way the router sees it.** SvelteKit decodes the path before matching, so `/%61pi/decks` reaches `/api/decks`. The guard applies the same decoding (`decodeURI` on each part between `%25`) and fails closed for a path that does not decode. Open paths are exactly `/api/schema` and anything outside `/api` (`/healthz`, pages, assets).
4. **The guard runs after the host check and before the content type check**, so a rebound host name is refused whatever is sent, and a caller without the token learns nothing about the API.
5. **No setting is needed.** The alternative of requiring `ORIGIN` to be configured would make the quick start fail the first time someone sets a token.

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Keep ADR-009 as written | Nothing new | The web page is locked out on plain HTTP | Does not work in the main deployment |
| Require the `ORIGIN` environment setting and compare against it | Exact scheme and host | One more setting that must match how people reach Tessera, and a wrong value locks out the page | Fails in the way users are least able to diagnose |
| Use `Referer` as the signal | Sent on same-origin requests | Tessera sends `Referrer-Policy: no-referrer`, and loosening it widens what the browser reveals | The marker needs no policy change |
| A cookie or nonce issued with the page | Familiar | Anyone can fetch the page and get it, so it proves nothing without a login | Adds machinery and no protection |
| Compare the whole `Origin` including scheme | Stricter | Never matches behind adapter-node's default | Fact 3 |
| Exempt by `User-Agent` | Easy | Forged by any script | Not a control |

## Consequences

### Positive
- The web page works with a token set, on loopback, on a network address over plain HTTP, and over HTTPS.
- The old Safari problem named in ADR-009 is gone.
- Other websites cannot reach the API through a visitor's browser, with or without the token. This is tested in a real browser, not only in unit tests.

### Negative
- A client that copies the browser's headers is accepted. This is documented in the deployment guide and the probe checks it so the documentation stays true. The token stops honest scripts and other websites. It does not stop a hostile client on the network, and was never going to without a login.
- A reverse proxy that uses HTTP Basic authentication uses the same `Authorization` header, so a script cannot send both through it. Documented.
- Opening an API address directly in a browser tab (`Sec-Fetch-Site: none`) needs the token.
- The scheme is not compared, so a page served by the same host and port under the other scheme would be accepted. Tessera does not serve both.

### Risks

| Risk | Mitigation |
|---|---|
| The marker header is accepted from another site if CORS is ever enabled | A browser test and a probe check that a preflight is granted nothing. Any future CORS support must come with a new decision. |
| A new route outside `/api` that returns private data | Today everything private is under `/api`. The probe and the route list are the check. New private routes belong under `/api`. |
| Brute-forcing the token | 24 or more characters from a random source, constant-time comparison, refusals logged with the request id and never the token. No lockout or delay is built. A hostile client on the network that can try thousands of guesses a second still faces about 96 bits when generated with `openssl rand -hex 32`. |
| A proxy removes `Origin` or `Sec-Fetch-Site` | The marker does not depend on either, and proxies pass custom headers. If all three are lost the page is treated as external, which fails closed. |

## Dependencies
- Depends on ADR-009 (the decision to have a token and its scope) and ADR-005 (host check, content type rule, no CORS).
- Constrains any future CORS support and any change to how the page calls the API (every call must go through `ui/api.ts`, which adds the marker).
