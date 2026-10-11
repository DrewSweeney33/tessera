# Staff Engineer Decisions: tessera-v1

**Date:** 2026-10-10
**Phase:** 2 Design
**Context:** Greenfield repository at `C:\Dev\tessera`. There are no existing patterns to reuse, so this file sets the conventions every later task follows.

## 1. Repository layout

```
tessera/
  src/
    lib/
      core/{schema,parse,scheduler}/  cloze.ts  typed-match.ts  cram.ts
      server/{db,repos,import,study,stats,export,http}/  config.ts  log.ts  clock.ts
      ui/                              Svelte components, Markdown.svelte, CardView.svelte
    routes/                            +layout.ts (ssr=false), pages, api/, healthz/
    hooks.server.ts                    CSP, host check, API token, request logging
  drizzle/                             generated migrations (committed)
  static/schema/                       tessera-deck.v1.schema.json (generated, committed)
  claude-skill/tessera-deck/SKILL.md
  docs/                                quickstart, deck-format, security, backup
  tests/{unit,integration,e2e,fixtures}/
  .github/workflows/                   ci.yml, release.yml
  Dockerfile  compose.yaml  LICENSE  README.md
  .10x/                                team state
```

## 2. Language and tooling

| Concern | Choice |
|---|---|
| Language | TypeScript 6.x, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, ESM only |
| UI | Svelte 5 runes. No legacy `$:` or stores for new code. |
| Lint | ESLint 10 flat config with `eslint-plugin-svelte` and `typescript-eslint` |
| Format | Prettier 3 with `prettier-plugin-svelte`. Format check in CI. |
| Types in Svelte | `svelte-check` in CI |
| Unit and integration tests | Vitest |
| End to end | Playwright |
| Migrations | `drizzle-kit generate`, committed, applied at boot |
| Package manager | npm with a committed `package-lock.json`, `save-exact=true` in `.npmrc`, `engine-strict=true` |

Scripts in `package.json`: `dev`, `build`, `start`, `check`, `lint`, `format`, `test`, `test:integration`, `test:e2e`, `db:generate`, `db:migrate`, `schema:emit`, `verify` (runs check, lint, format check, tests, schema diff).

## 3. Code conventions

- **Files:** kebab-case. Types and components PascalCase. Database columns snake_case, mapped to camelCase in Drizzle.
- **Public surface:** each unit folder has an `index.ts` that exports only its interface. Cross-unit imports go through `index.ts`.
- **Errors:** expected failures return `Result<T, E>`. Throw only for programmer errors and infrastructure failure. HTTP errors use one shape: `{ "error": { "code": "...", "message": "...", "details": ... } }`.
- **Config:** read once at boot from environment, validated with Zod, frozen. The app exits with a readable message when invalid.
- **Time and randomness:** inject `Clock` and `rng`. Never call `Date.now()`, `new Date()`, or `Math.random()` inside `core` or `server` logic.
- **Database:** repositories only. No SQL outside `repos/` and `db/`. A `withTx(db, fn)` helper wraps transactions. Statements are parameterized through Drizzle.
- **IDs:** review ids are UUID v4 from `crypto.randomUUID()`. Card keys follow ADR-002.
- **Logging:** a tiny `log.ts` writes one JSON line per event to stdout. Never log card content, typed answers, or tokens.
- **Comments:** explain why, not what. Reference ADR numbers where a rule comes from an ADR.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`). Phase checkpoints use `state(<phase>): ...`.
- **Dependencies:** a new runtime dependency needs a one-line justification in the PR and must pass the license check (MIT, Apache-2.0, ISC, BSD, MPL-2.0).

## 4. API conventions

- `/api/*` returns JSON, uses plural nouns, and never changes state on `GET`.
- Mutating JSON routes require `Content-Type: application/json` (415 otherwise). Import also accepts `text/markdown`.
- Error codes are stable strings (`validation_failed`, `stale_review`, `not_found`, `payload_too_large`, `unauthorized`).
- Responses include `X-Request-Id`.
- The OpenAPI-style contract for each route lives in `docs/api.md` and is covered by integration tests.

## 5. UI conventions

- **Keyboard first.** Every study action has a key. Focus is managed explicitly after reveal and grade. Visible focus rings. No action requires a mouse.
- **Accessibility:** WCAG 2.2 AA contrast, semantic landmarks, `aria-live` announcements for grade results and errors, `prefers-reduced-motion` respected, works at 200 percent zoom.
- **Responsive:** primary target a phone portrait layout and a desktop window. Touch targets at least 44 px.
- **Theming:** CSS custom properties for color, spacing, radius, type scale. Light and dark via `prefers-color-scheme` plus a manual toggle stored in `localStorage` (wrapped in try/catch).
- **Rendering untrusted content:** only through `Markdown.svelte` (ADR-005). No other use of `{@html}`.
- **Visual direction** is chosen at implementation start, using the installed design skills (`impeccable` or `hallmark` for the audit and build passes). The interaction model above is fixed first.
- **Empty and error states** are designed for every list and form, with a next action.

## 6. Testing standards

| Layer | What | Targets |
|---|---|---|
| Unit (Vitest) | `core/*`, matcher, cloze parsing, queue ordering with fake clock, import planning on in-memory SQLite | `core` at least 90 percent line coverage |
| Property tests | JSON and Markdown parse equivalence, re-import idempotence, serialize then parse round trip | `fast-check` |
| Conformance | Scheduler output versus fixtures generated from the `ts-fsrs` reference | 100 percent of fixtures |
| Integration | Routes against a temp SQLite file: import rollback, migration backup, auth, content type, host check | `server` at least 80 percent |
| Security | Known XSS payload corpus against `Markdown.svelte`, CSP header presence, token enforcement | all pass |
| End to end (Playwright) | Import, study, grade, leech, cram, stats, keyboard-only run | one happy path plus keyboard-only per milestone |
| Fixtures | `tests/fixtures/decks/`: golden valid decks (realistic Claude output), malformed decks with expected error lists | grows with every bug |

A task is done when `npm run verify` passes, new behavior has tests, and any user-visible change is in `docs/`.

## 7. CI and release

- **ci.yml:** on push and PR: install, `verify`, `npm audit --omit=dev`, license check, Playwright, Docker build, smoke test (`docker run`, wait for `/healthz`, import a fixture deck, fetch `/api/schema`).
- **release.yml:** on tag `v*`: multi-arch build, push to GHCR (`:semver`, `:latest`), attach the JSON Schema and the Claude skill as release assets, record compressed image size.
- Actions pinned by SHA. Dependabot for npm, Docker, Actions.
- `static/schema/tessera-deck.v1.schema.json` is regenerated in CI and fails the build on a diff, so the published schema can never drift from the Zod source.

## 8. Reuse and cross-cutting concerns

| Concern | Decision |
|---|---|
| Validation | One Zod source. No second schema anywhere. |
| Markdown | One component. |
| Dates | One `clock.ts`. |
| Config | One `config.ts`. |
| HTTP auth, CSP, host check | `hooks.server.ts` calling `server/http/*`. Not per-route. |
| Error mapping | One `server/http/errors.ts` converts `Result` and thrown errors to responses. |
| Logging | One `log.ts`. |

## 9. Documentation deliverables

`README.md` (30-second pitch, quickstart, security warning), `docs/quickstart.md`, `docs/deck-format.md` (both formats, field table, examples), `docs/claude-workflow.md` (how to ask Claude for a deck, how to feed back the weak-spot report), `docs/security.md`, `docs/backup.md`, `docs/api.md`, `CONTRIBUTING.md`, and `claude-skill/tessera-deck/SKILL.md`.

## 10. Risks to watch

- Hand-rolled Markdown parser drifting from the JSON path: guarded by property tests.
- UI polish consuming the schedule: interaction model and accessibility fixed first, visual pass bounded to M5.
- Kit 3.x and Drizzle 0.x churn: exact pins, scaffold on day one of M1.
