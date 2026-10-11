# Tessera

Self-hosted flashcards that Claude can write for you. Import a deck, study it with FSRS spaced repetition, send your weak spots back to Claude, and re-import the revised deck without losing progress.

**Status:** early development. Design and plan live in [`.10x/`](.10x/). The full README arrives with the first release.

## Security note

Tessera has no login. Run it behind a reverse proxy with authentication, or on a private network you trust. The sample `compose.yaml` will publish only on loopback by default.

## Development

```bash
npm ci
npm run dev
npm run verify
```

`npm run verify` runs the type check, lint, formatting check, and tests. Node 24 is expected.

## License

AGPL-3.0. The license text file is added before the first release.
