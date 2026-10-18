# ADR-018: An installable app shell with an offline notice

**Status:** Accepted by the owner on 2026-10-18 (design conversation for Milestone 5, "Yes").
**Date:** 2026-10-18
**Feature:** tessera-v1 (Milestone 5)
**Author:** Claude (Architect + Staff Engineer)
**Spec:** `.10x/specs/2026-10-18-milestone-5-pwa-and-close-out-design.md`

## Context

The original design said the web UI would be "installable as a PWA" and decided (spec section 20, decision 7) that the scope is an installable app shell with no offline study, because the study queue is server-authoritative (ADR-003). Nothing of it exists yet: no manifest, icons, or service worker. Constraints:

- The page is client-rendered (`ssr = false`) from a thin HTML shell; the data comes from `/api/*` (ADR-006).
- The CSP is `default-src 'self'` with `script-src 'self'` (ADR-005); a same-origin worker and manifest are allowed without relaxing it.
- The API token and host check guard `/api/*` and the host respectively (ADR-009, ADR-011). Pages are not token routes.
- A service worker runs only in a secure context: HTTPS or localhost. The live instance is reachable at `https://tessera.sweentech.com` (through NPM) and at `http://192.168.30.102:3000` (not secure).
- A stale cache is the classic way a service worker breaks an app after an upgrade.
- Dependencies are kept to the minimum (ADR-007); a build-time image tool would add one.

## Decision

1. **Installable shell with an offline notice.** A web app manifest and icons make Tessera installable (a home screen icon and its own window). A small service worker shows a plain offline page when the server cannot be reached. There is no offline study and no cached data of any kind.
2. **The worker intercepts navigations and nothing else.** For a same-origin navigation it tries the network and, when the fetch fails or takes longer than 8 seconds, answers the cached offline page. Every other request, including every `/api/*` call, every asset, and every non-GET, is not intercepted (no `respondWith`). A reachable server always shows its live page, and an HTTP error is shown as the server sent it.
3. **The cache holds the offline page and the icons only,** under `tessera-shell-<version>` (the build version from `$service-worker`). On activate every cache with the prefix `tessera-shell-` other than the current one is deleted. No page, study item, or API response is ever stored. The pure rules (is this a navigation to handle, which caches to delete, the timeout) live in `src/lib/core/service-worker.ts` so they are unit tested without a browser.
4. **Registration is SvelteKit's own** (`src/service-worker.ts`, registered in production). It is feature-detected by the browser, so the plain-HTTP LAN address simply has no worker, no install prompt, and no offline page, and works as before. The docs say so.
5. **Icons are rendered once and committed.** `scripts/make-icons.ts` draws the logo SVG into 192, 512, maskable 512, and 180 (Apple touch) PNGs with the Playwright Chromium that is already a dev dependency. Nothing is generated at build time and no dependency is added.
6. **The offline page is static** (`static/offline.html`): inline styles, no script, system fonts, light and dark by `prefers-color-scheme`, a heading, and a Try again link. It makes no requests.
7. **Release order.** 0.2.0 (the three migrations since 0.1.1) is released first. The installable app and the docs ship as 0.3.0, and v1.0.0 follows a real-phone pass by the owner.

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Manifest and icons only, no worker | Nothing to go stale | Offline shows the browser's error page; some browsers do not offer Install without a worker | The owner chose the shell with the offline notice |
| Cache the app shell and assets for fast starts | Faster repeat loads, partial offline UI | Stale-shell risk after upgrades, cache invalidation to get right, a UI that cannot load data and looks broken | The gain is small on a LAN and the risk is the main failure mode of workers |
| Offline study with background sync | Study anywhere | Breaks the server-authoritative queue, needs conflict handling, large surface | Out of scope for 1.0 (spec decision 7) |
| Generate icons with an image library at build time (sharp) | Always in step with the logo | A native dependency, install scripts disabled (ADR-007), build-time work | The logo changes rarely; rendering once with an existing tool is enough |
| Workbox | Mature routing and caching helpers | A dependency and generated code for a worker of about 40 lines | Not needed |
| A custom in-app Install button | One more way to install | Browser-specific events, more UI to test | Browsers provide their own entry |

## Consequences

### Positive

- Tessera can be installed on a phone or desktop from the HTTPS address, with a clean offline message instead of a browser error.
- The API, the token flow, and the study queue are unchanged; a test proves the worker never touches them.
- No new dependency and nothing generated at build time.

### Negative

- Install and the offline page do not exist at the plain-HTTP LAN address.
- Two more static files to keep in step with the design tokens (manifest colours, offline page colours); a test compares them with the tokens.
- A worker is a new kind of component: it needs its own tests and a probe section.

### Risks

| Risk | Mitigation |
|---|---|
| A worker serves stale content after an upgrade | It stores no page; the one cached page lives under a versioned name replaced on activate; tested |
| The worker interferes with the API | It intercepts navigations only; a test checks requests to `/api/*` pass through |
| A failing navigation is mistaken for being offline | Only a rejected fetch or an 8 s timeout shows the offline page |
| The cache name collides with another app on the origin | The prefix `tessera-shell-` and cleaning only caches with it |

## Dependencies

- Builds on ADR-003 (server-authoritative queue), ADR-005 (CSP), ADR-006 (JSON API and thin shell), ADR-007 (no new dependencies), ADR-009 and ADR-011 (token and host rules).
- Constrains any future offline feature: it would need its own ADR and would supersede decisions 2 and 3 above.
