# Senior Engineer Index

## Cross-cutting principles

- Test first for pure code. Fixtures are shared assets and grow with every bug.
- Self-review checklist before every commit: layer rules, injected time and randomness, SQL only in repos, `{@html}` only in `Markdown.svelte`, `Result` for expected failures, no card content in logs.
- Sanitization is tested in a real browser, not jsdom.
- Synchronous transactions: no `await` inside `better-sqlite3` transactions.
- Review gates after the import commit, the review submission, the XSS corpus, and the Markdown parser.

## Features

| Feature | File | Status |
|---|---|---|
| tessera-v1 | `tessera-v1.md` | Approach set for M1 and M2, notes for M3 to M5 |
