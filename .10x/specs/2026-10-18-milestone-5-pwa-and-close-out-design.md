# Design: Milestone 5, installable app and close-out

**Date:** 2026-10-18
**Feature slug:** `tessera-v1` (Milestone 5)
**Status:** Approved by the owner on 2026-10-18 in a design conversation. ADR: `.10x/adrs/018-installable-app-shell-and-offline-notice.md`.

## Why

The original Milestone 5 (36 hours) was written before the library, leeches, new look, folders, practice, and statistics were built. Re-planned against the code, most of it is done: the visual polish came with the 2026-10-12 redesign, the accessibility and 320 px checks run in e2e on three browsers, and the docs exist. What is new is the installable app (US in the original spec: "installable PWA"). What is left is verification on a real phone, two small docs, the final QA and security reviews, and the releases.

## What the code has and lacks

| Piece | State |
|---|---|
| Manifest, icons, service worker | None. `static/` has fonts, `robots.txt`, the schema, and `theme-init.js`. The logo is `src/lib/assets/favicon.svg`. |
| `theme-color` meta tags | Present in `+layout.svelte` for light and dark |
| Page shell | `ssr = false`, so the HTML is a thin shell and every route is client-rendered |
| CSP (ADR-005) | `default-src 'self'`, `script-src 'self'`: a same-origin worker and manifest are allowed, nothing to relax |
| API token and host check (ADR-009, ADR-011) | Guard `/api/*` only. Pages, the manifest, and the worker are not token routes |
| Docs | README, operations, deploy, security, performance, workflow guide exist. No CONTRIBUTING, no troubleshooting page |

## Decisions the owner made

1. **Scope: an installable shell with an offline notice.** Not manifest-only, and not offline study (the queue is server-authoritative, ADR-003).
2. **Order:** 0.2.0 is released first (candidate, harness run with `--expect-migration`, release). The installable app and the docs go out as 0.3.0, and v1.0.0 is cut after a real-phone pass.

## 1. Installable app

- `static/manifest.webmanifest`: `name` "Tessera", `short_name` "Tessera", `description`, `start_url` "/", `scope` "/", `display` "standalone", `background_color` and `theme_color` from the tokens (the light paper colour, the same value the light `theme-color` meta uses), `icons`. Linked from `app.html` with `<link rel="manifest">`.
- Icons: `static/icons/icon-192.png`, `icon-512.png`, and `icon-maskable-512.png` (the logo inside the safe zone on a solid background), plus `static/icons/apple-touch-icon.png` (180 px). Rendered once from the logo SVG with the Playwright Chromium that is already a dev dependency, by `scripts/make-icons.ts`, and committed. No new dependency and nothing runs at build time.
- Served with the right types (`application/manifest+json`, `image/png`) by the existing static handler. A test checks the types and that every icon the manifest names exists and has the size it claims.

## 2. Service worker

`src/service-worker.ts` (SvelteKit registers `/service-worker.js` in production). It does three things and nothing else:

| Event | Behaviour |
|---|---|
| install | Open the cache named `tessera-shell-<version>` and add the offline page (`/offline.html`) and the icons. `skipWaiting()` |
| activate | Delete every cache whose name starts with `tessera-shell-` and is not the current one. `clients.claim()` |
| fetch | Only for a **navigation** (`request.mode === 'navigate'`) to this origin: try the network; if it fails (offline, the server is down, a timeout of 8 s), answer the cached offline page. Every other request (API calls, assets, fonts, images, non-GET) is not intercepted at all: the worker does not call `respondWith` for it |

Rules it must keep:

- **Never touches `/api/*`**, never stores an HTML page, a study item, or any response other than the offline page and the icons it was installed with.
- **Never rewrites a response**, never answers a request the network could answer. A reachable server always shows the live page.
- The cache name carries the build version, so a new version replaces the old shell on the next visit.
- It does not hold state or timers across events.

`static/offline.html` is a plain, self-contained page (inline styles, no script, system fonts, light and dark through `prefers-color-scheme`) that says: "Tessera needs your server. Check your connection or VPN, then try again." with a Try again link to `/`. It sets `lang`, a title, and a heading, and passes the same axe checks as the other pages. It makes no network requests (the CSP allows inline styles).

## 3. Secure context

Service workers exist only in a secure context. `https://tessera.sweentech.com` and `http://localhost` qualify; `http://192.168.30.102:3000` does not. The registration is feature-detected, so the app behaves exactly as before at the plain-HTTP address (no install prompt, no offline page, nothing breaks). The docs say this.

## 4. Verification

| Check | How |
|---|---|
| Manifest valid and complete | Unit test on `manifest.webmanifest`: required members, `display`, `start_url`, `scope`, icon files exist with the stated sizes and a maskable one, colours match the tokens |
| Served correctly | Integration or e2e: types, no redirect, 200 without the token even when one is set, 421 for a foreign host, CSP present |
| Worker registers | e2e (Chromium, WebKit; Firefox where it runs): `navigator.serviceWorker.ready`, one controller after a reload |
| Offline page | e2e: register, go offline (`context.setOffline(true)`), navigate, see the offline heading; back online, the live page returns |
| Never touches the API or stores data | e2e and unit: with the worker active, `/api/*` requests are not intercepted (checked through the network log), and the cache holds only the offline page and the icons |
| Old shells are removed | Unit test of the activate logic with a fake cache storage (the pure parts are in `src/lib/core/service-worker.ts` so they can be tested without a browser) |
| Accessibility and layout | The offline page is in the axe scan, both themes, and at 320 px |
| Probe | The manifest, worker, offline page, and icons answer GET only; a foreign host gets 421; no stack traces; no CORS approval |
| Real phone | A short checklist (`docs/phone-checklist.md`): install, study, offline, dark mode, rotate, a screen reader pass if available. This is the owner's part |

## 5. Docs

- `CONTRIBUTING.md`: how to set up, the layer rules, the checks to run, how tests are written (planted bugs), how to propose a change, the licence.
- `docs/troubleshooting.md`: the problems seen so far and their fixes (421 host check, token 401, a full disk, a restore that did not start, an upgrade that failed, the page blank, install not offered).
- README and `docs/operations.md`: an "Install as an app" section that says what it does, that it needs HTTPS, and that offline study is not a feature.

## 6. Close-out

- QA report and security review for Milestone 4 and the installable app (`.10x/reviews/`), including the live-image harness run with `--expect-migration` against the 0.2.0 candidate.
- SRE and DevOps notes in `.10x` (what to watch, runbook pointers, the image size record).
- Releases: 0.2.0 (candidate, harness, release), then 0.3.0 (installable app and docs), then v1.0.0 after the phone pass.

## Out of scope

Offline study or any cached study data, background sync, push notifications, an in-app "Install" button (browsers provide one), a custom splash screen, share targets, shortcuts in the manifest, and any change to the API, the schema, or the deck formats.

## Tasks

| ID | Task | Size |
|---|---|---|
| M5-01 | Manifest, icons (`scripts/make-icons.ts`), `app.html` links | S |
| M5-02 | Service worker, `static/offline.html`, pure logic in core, unit tests | M |
| M5-03 | e2e (registration, offline, API untouched), accessibility, probe entries | M |
| M5-04 | CONTRIBUTING, troubleshooting, install docs, phone checklist | M |
| M5-05 | QA report and security review (M4 and the installable app), harness run | M |
| M5-06 | `.10x` close-out, vault notes, releases (0.2.0, 0.3.0) | S |

About 14 hours in the plan's units.

## Risks

| Risk | Mitigation |
|---|---|
| A worker serves a stale page after an upgrade | It never stores a page; the only thing cached is the offline page, under a versioned name that is replaced on activate |
| The worker breaks the API or the token flow | It does not intercept anything except navigations, and a test proves requests to `/api/*` pass untouched |
| A navigation that fails for a reason other than being offline shows the offline page | Only a network failure (a rejected fetch or an 8 s timeout) shows it; an HTTP error from the server is shown as the server sent it |
| The install prompt does not appear on the LAN address | Documented: it needs HTTPS or localhost |
| Icons look wrong on a launcher | A maskable icon inside the safe zone and a checklist step on a real phone |
| A cache name collision with another app on the same origin | The prefix `tessera-shell-` and cleaning only caches with that prefix |
