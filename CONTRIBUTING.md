# Contributing to Tessera

Thank you for looking. Tessera is a small, self-hosted flashcard app written to be read: the code is layered, tested hard, and documented where a decision is not obvious. This page is the short version of how to work on it.

## Before you start

- Tessera is free software under the GNU Affero General Public License, version 3 only (`AGPL-3.0-only`, see [LICENSE](LICENSE)). By contributing you agree your change is released under the same licence.
- For anything bigger than a bug fix, open an issue first and describe what you want to change and why. The design is deliberate (see the [architecture decisions](.10x/adrs/)), and a change that fights one of them needs a conversation before code.
- Security problems go through [SECURITY.md](SECURITY.md), not a public issue.

## Set up

```bash
npm ci                # Node 24; no compiler needed, install scripts are off (ADR-007)
npm run dev           # development server
npm run verify        # type check, lint, schema check, unit and integration tests
npm run build
npm run test:e2e      # browser tests; run the build first (npx playwright install chromium)
```

`npm run test:e2e:all` runs the browser tests on Chromium, Firefox, and WebKit one after the other. CI runs all three, and a change that passes on one can fail on another, so look at the CI result of every push.

## How the code is organised

Three layers, enforced by lint (`eslint.config.js`), so a violation fails the build:

| Layer  | Folder                     | May import           | Holds                                                                                                    |
| ------ | -------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| core   | `src/lib/core`             | nothing outside core | Pure rules: deck format, scheduling wrapper, study day, statistics maths. No Node, no database, no clock |
| server | `src/lib/server`           | core                 | Database (`db`, `repos`), services, HTTP handlers                                                        |
| ui     | `src/lib/ui`, `src/routes` | core                 | Components and pages. Never imports server code                                                          |

Other rules the build enforces:

- Time and randomness are injected. No `Date.now()`, `new Date()` with no argument, or `Math.random()` in core or server; take a `Clock` or `Rng`.
- Only `core/scheduler` imports `ts-fsrs`. Only `db` and `repos` import the database driver or Drizzle.
- `{@html}` appears only in `src/lib/ui/Markdown.svelte`. Card text is untrusted.
- Practice again (`src/lib/server/practice`, `src/lib/core/practice.ts`) cannot import anything that changes a schedule.
- Import with `#lib/...` and the `.ts` extension.

The deck formats (JSON and Markdown) are the product: read `docs/deck-format.md` before touching them. A change to a user-visible message, label, limit, or error code usually needs `docs/`, the Claude skill (`claude-skill/tessera-deck/SKILL.md`), and `CHANGELOG.md` updated together; `tests/unit/docs` fails when they drift.

## Tests

Every change comes with tests, and the tests are written to fail:

- **Unit** (`tests/unit`): pure logic, fast, no database.
- **Integration** (`tests/integration`): real SQLite in a temp folder through the real migrations, calling the same handlers the routes call.
- **End to end** (`tests/e2e`): Playwright against the production build, including an accessibility scan (axe) of each screen state in both themes and a 320 px layout check. Every e2e spec uses its own deck ids because the specs share one server.
- **Security probe** (`npm run security:probe`): hundreds of hostile requests against a real server. A new route or write path gets probe entries in `scripts/security-probe.ts`.

After you write a test, prove it can fail: change the code to be wrong (a "planted bug") and watch the test catch it, then put the code back. A test that cannot fail is not a test.

Layout and logic that depend on the clock use the injected fake clock (`tests/helpers/fake-clock.ts`); never wait on the real one.

## Changing the database

Migrations are forward-only (ADR-008). Edit `src/lib/server/db/schema.ts`, run `npm run db:generate -- --name <what>`, **read the generated SQL** (drizzle-kit has dropped an `ON DELETE` clause before), and add a test that upgrades a database made by the previous migrations with data in it. A release that adds a migration says so in the changelog, because it changes what rolling back means.

## Pull requests

1. Branch from `main`, keep the change focused, and keep the commit message in the style of the log (`feat(area): what changed`, a short body that says why).
2. Run `npm run verify`, and the e2e tests for anything that touches a page.
3. Update `CHANGELOG.md` under `[Unreleased]`, written for the person running Tessera, not for a developer.
4. Do not add a dependency without saying why. The dependency list is short on purpose, and licences are checked (`npm run licenses`).

Writing style for docs and messages: plain, short sentences; say what happens and what to do next; no jargon where a normal word works.
