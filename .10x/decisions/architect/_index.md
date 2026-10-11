# Architect Index

## Cross-cutting principles

- Pure core, thin server, thinner routes. Business rules live in `core` or `server`, never in routes or components.
- One validator for deck input. Both formats converge before validation.
- Third-party algorithms sit behind our own interface (`ts-fsrs` only inside `core/scheduler`).
- Server-authoritative study queue. The browser never decides scheduling.
- Never lose review history. Imports update and archive, never delete.
- Every time read goes through an injected clock.
- All SQL goes through repositories.

## ADRs

| ADR | Topic |
|---|---|
| 001 | Stack and storage |
| 002 | Deck format and idempotent import |
| 003 | Scheduler isolation, queue, cram |
| 004 | Container and base image |
| 005 | Security posture without login |

## Features

| Feature | File | Status |
|---|---|---|
| tessera-v1 | `tessera-v1.md` | Design complete |
