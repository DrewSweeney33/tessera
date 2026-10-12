# Security

This page says what Tessera protects, what it does not, and what you need to do. It is written for the person running Tessera. To report a problem, see [SECURITY.md](../SECURITY.md). The reasoning behind each decision is in [ADR-005](../.10x/adrs/005-security-posture-without-login.md).

## The short version

- **Tessera has no login.** Anyone who can open the page in a browser can read, change, and delete everything in it.
- So the way you reach it is the protection. Out of the box the port is open on the machine it runs on and nowhere else (`127.0.0.1`).
- To use it from a phone or another computer, use a private network such as Tailscale or WireGuard, or a reverse proxy that asks for a password. [docs/deploy.md](deploy.md) shows how.
- Never put it on the internet without a proxy that requires a password.
- Inside that boundary, Tessera defends itself against hostile deck content, hostile web pages in your browser, and malformed requests. Those defenses are described below, with their limits.
- Keep backups. They are the answer to almost every bad outcome. See [docs/operations.md](operations.md).

## What is worth protecting

| Asset                      | Why it matters                                                                   |
| -------------------------- | -------------------------------------------------------------------------------- |
| Your review history        | Weeks or months of effort. It cannot be recreated from a deck file.              |
| Your decks                 | Mostly study material, usually low sensitivity. You decide what you put in them. |
| That the app keeps working | A study tool you cannot open on the day you need it is not much use.             |

Tessera holds no accounts, no passwords, no payment details, and no personal data beyond what you type into cards. Do not put secrets in cards. They are stored as plain text in the database file, like everything else.

## Who might cause harm

In order of how likely each is:

1. **A careless or hostile deck.** Decks come from an AI assistant or from the internet, and card text is rendered as formatted text, code, and diagrams. That is untrusted input going into your browser.
2. **A hostile web page open in the same browser.** A page you visit can try to send requests to services on your own computer or network, or trick your browser into doing so.
3. **Another device on your network**, if you open the port beyond your own machine.
4. **A compromised software dependency or base image.**
5. **Your own mistakes**, such as exposing the port or importing the wrong file.

A targeted attack by a skilled adversary is out of scope. Tessera is a personal study tool, not a service holding other people's data.

The worst realistic outcome is that your decks are changed or deleted, not that something sensitive leaks. A backup restores it.

## What Tessera does about each

### Network exposure

- The sample `compose.yaml` publishes the port on `127.0.0.1` only. Opening it further is an explicit edit, with a warning in the file.
- There is no built-in authentication. That is a decision, not a gap: access control belongs to a VPN or a reverse proxy, which do it better than a login screen added to a small app.

### Host names (blocks DNS rebinding)

A hostile page can point a domain it controls at your server's address, so your browser treats requests to that domain as if the page were talking to itself. The page cannot fake the host name it arrived under. Tessera answers only to names it is meant to be reached by and refuses the rest with a `421` reply.

Without a setting it answers `localhost`, any IP address, single-word names such as `tessera`, and names ending in `.local`, `.lan`, `.home.arpa`, `.internal`, or `.localdomain`. **If you reach Tessera by a real domain name, you must set `TESSERA_ALLOWED_HOSTS`.** Details and examples are in [docs/deploy.md](deploy.md#host-names-protection-against-dns-rebinding). The startup log says which rules are in force.

### The API token (for scripts, not for people)

Setting `TESSERA_API_TOKEN` makes the API ask for a password from anything that is not the Tessera web page. It stops scripts that do not pretend to be the page, and it stops other websites from using a visitor's browser to reach your Tessera.

**It is not a login.** The web page has no authentication, so anyone who can open the page can use it. A script that copies what the page sends can use the API too. The token does not replace a VPN or a password-protecting proxy. If other people or devices on your network must not use your Tessera, put it behind one of those. See [docs/deploy.md](deploy.md#the-api-token-for-scripts-not-for-the-web-page) for how the page is recognised and for the two things that can surprise you.

The token must be at least 24 characters, is compared in constant time, and is never written to a log.

### Other websites

- Write requests must be JSON (or Markdown for import) with the right content type. A page on another site cannot send that without asking the browser's permission first, and Tessera never grants it. It sends no cross-origin permission headers at all.
- Changes are made only with `POST`, `PUT`, `PATCH`, or `DELETE`. A plain link or image on another page cannot change anything.
- SvelteKit's own origin check refuses form posts from other sites.

### Card content

Card text is untrusted. It is displayed in two protective layers: raw HTML is shown as text rather than interpreted, and the result is cleaned again before it reaches the page. Images and links with unsafe addresses (`javascript:`, `data:`, and others) are removed, and the links that remain open with `noopener noreferrer`.

- **Code** is highlighted by building the page elements from plain text, so no HTML from the card is ever parsed.
- **Diagrams** are drawn in the strictest mode of the diagram library, cleaned again, and shown as an image, which cannot run anything. A diagram that cannot be drawn shows its source instead.

### Content Security Policy

The browser is told to run scripts only from Tessera itself (`script-src 'self'`), to load nothing from other sites, to refuse being put in a frame, and to allow no plug-ins. So even if hostile content got through the layers above, the browser would refuse to run it or send anything out. Styles may be inline, which is a known and accepted trade-off: it does not allow script to run.

### Limits on what can be sent

- A request body can be at most 5 MB, a deck at most 5,000 cards, and field sizes are limited. Over the limit gets a clear error, not a crash.
- Everything sent to the server is checked against a strict schema. Unknown fields, wrong types, and odd Unicode are refused with a message that names the field.
- Database queries are parameterized, never built from text.
- Imports are all or nothing: a failed import changes nothing.

### Logs

The server writes one line per request. Logs never contain card text, typed answers, or the API token. This is checked on every CI run by sending a marker through the app and searching the whole log.

### The container

It runs as a normal user (not root), with a read-only filesystem apart from `/data` and `/tmp`, no extra Linux capabilities, and `no-new-privileges`. The image does not include npm, corepack, or yarn (the server needs only Node), and has no secrets baked in. It restarts after a crash and is marked unhealthy if the database stops answering.

### Software supply chain

- Dependencies are pinned to exact versions, installs do not run package scripts, and the production dependency audit and a license check run in CI.
- Every GitHub Action is pinned to a specific commit.
- The published image is scanned for known vulnerabilities before a release can go out, and the scan fails on any high or critical finding that has a fix.
- Releases carry checksums, and the zip files are built so that the same source always gives the same bytes.

## What you should do

- [ ] Keep the port on `127.0.0.1` unless you have a reason. If you need other devices, use a VPN or a password-protecting proxy.
- [ ] If you use a real domain name, set `TESSERA_ALLOWED_HOSTS`.
- [ ] Only set `TESSERA_API_TOKEN` if you have scripts that call the API, and keep the token out of anything you share or commit.
- [ ] Do not import decks you do not trust without looking at the preview. The preview shows exactly what will change before anything is saved.
- [ ] Keep backups somewhere other than the same disk, and test a restore once.
- [ ] Update when a new version comes out. Only the latest release gets fixes.
- [ ] Do not put secrets in cards.

## What Tessera does not protect against

- **Anyone who can reach the port or open the page.** There is no login.
- **Anyone with access to the machine or its disk.** The database is a plain file and is not encrypted.
- **Traffic you send over plain HTTP across a network.** Tessera speaks plain HTTP. Use a VPN or a proxy that provides HTTPS if the network is not yours.
- **A flood of requests.** There is no rate limiting. That is acceptable for one person behind a proxy or VPN.
- **Mistakes in your own decks.** Tessera checks the structure, not whether the facts are true.

## Known and accepted risks

These are tracked in the security reviews in `.10x/reviews/`.

| Risk                                                           | Why it is accepted                                                                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inline styles are allowed by the Content Security Policy       | The interface and the diagram library need them. They cannot run script, and card content cannot add styles.                                       |
| Four moderate advisories in `drizzle-kit`, a developer tool    | It is used only to write database migrations. Its development server is never started, and it is not in the image.                                 |
| One low advisory in KaTeX, reached through the diagram library | It needs an existing prototype pollution to matter, and the diagram library does not enable the affected feature. Tested with hostile math labels. |
| No rate limiting                                               | One user behind a VPN or proxy.                                                                                                                    |

## How this is checked

- `npm run security:probe` starts the built server and runs more than 200 adversarial checks: foreign host names, cross-site requests, token bypass attempts, oversized and malformed input, injection attempts, and log leaks. It runs in CI on Linux.
- A corpus of hostile card content (scripts, event handlers, bad links, hostile diagrams, hostile math) runs in three browser engines on every push. Turning off the sanitizer makes 23 of those tests fail, which is how we know they would notice.
- Deliberate bugs are introduced into the security logic from time to time to check that the tests catch them. See the QA report in `.10x/reviews/`.
- The container image is scanned in CI.

None of this is a guarantee. If you find something that breaks a protection described here, please report it as described in [SECURITY.md](../SECURITY.md).
