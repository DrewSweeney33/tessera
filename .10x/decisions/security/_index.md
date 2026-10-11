# Security Decisions: Index

## Active features

| Slug | Summary | Status |
|---|---|---|
| `tessera-v1` | Threat model, verified controls, and findings for the Tessera build | M1 reviewed (interim). Review again at the M2 exit and final at M5. |

## Cross-cutting security principles

- **No login, so the network boundary is the security boundary.** Loopback by default, a host check against DNS rebinding, and a reverse proxy or VPN for anything wider. The README says so plainly.
- **Untrusted by default:** deck text, anything an LLM wrote, and every request body. Validate strictly at the boundary and reject unknown fields.
- **Two independent layers wherever a failure is costly** (CSRF: origin check plus JSON-only guard; XSS: renderer plus sanitizer). Test each alone.
- **Never log card content, typed answers, or tokens.** Tested against the real server log.
- **Controls that are specified but not built are findings.** Track them as open, show them as KNOWN in the probe, and do not describe them as working in the README.
- **The security probe runs in CI.** Every new route is added to it.
