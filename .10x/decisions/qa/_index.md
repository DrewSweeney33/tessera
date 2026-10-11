# QA Decisions: Index

## Active features

| Slug | Summary | Status |
|---|---|---|
| `tessera-v1` | Test strategy, gate results, defects, and residual risks for the Tessera build | M1 verified (interim). Full verification at the M2 and M5 exits. |

## Cross-cutting QA principles

- **Every security or integrity test gets a negative control.** Break the thing on purpose and see the test fail. A test that has never failed proves little. This found a real gap in the XSS suite and a real gap in CSP coverage.
- **Test each layer of a two-layer defence alone.** The browser corpus passed with the sanitizer disabled because the first layer already caught everything.
- **Test the built server, not only the source.** Headers, body limits, chunked encoding, and kill behaviour only show on the real artifact.
- **Isolate e2e tests with their own data.** The e2e database persists across tests in a run, and studying changes state. Each test creates its own deck.
- **Client-rendered app: wait for the page before sending keys.** Pressing keys right after `goto` is a recurring test bug.
- **Coverage is a signal.** Use mutation checks on the invariants that matter (idempotence, staleness, limits, headers).
