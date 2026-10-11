# SRE Decisions: Index

## Active features

| Slug | Summary | Status |
|---|---|---|
| `tessera-v1` | Service levels, failure modes, monitoring, and runbooks for self-hosted Tessera | M1 slice assessed. Ready for the owner's own use behind loopback or a VPN with backups. Not ready for a public release. |

## Cross-cutting SRE principles

- **The user is one person, and the data is the service.** Availability matters little. Not losing review history matters a great deal. Targets and effort follow that.
- **Targets that can be measured on the real build**, not aspirations. Each one has a test or a measurement behind it.
- **Alert on symptoms.** The only signal that matters to a self-hoster is "does it answer, and do I have a recent backup". Nothing else is worth waking anyone for.
- **Fail loud at startup, never limp.** A bad config, a damaged database, or a database from a newer version stops the server with a message that says what to do, and changes nothing.
- **Mitigate first.** Restore from a backup before investigating. The runbook is ordered that way.
- **Name what was not exercised.** Disk full, silent mid-file corruption, a long soak beyond minutes, Docker, and Linux are listed as gaps, not claimed.
