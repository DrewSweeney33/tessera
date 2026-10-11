# Security Policy

## How Tessera is meant to be run

Tessera is a single-user app with **no login**, by design. It is meant to run on `127.0.0.1`, on a private network such as a VPN, or behind a reverse proxy that requires a password. The deployment guide ([docs/deploy.md](docs/deploy.md)) explains each option. Reaching an unprotected Tessera over a network is not a vulnerability in Tessera, because the lack of a login is the documented design.

## What to report

Please report anything that breaks a protection Tessera does claim:

- Script running from card content (cross-site scripting), or a way around the Markdown sanitizing.
- A web page on another site being able to read or change data in a Tessera that is only reachable on `localhost` or a private address (cross-site request forgery, DNS rebinding).
- A way to get the server to read or write files outside its data folder, run commands, or reach other hosts.
- A crash or hang caused by a crafted deck or request.
- A secret or card content appearing in logs.
- A vulnerable dependency that the published image actually uses.

The current known gaps are listed in the security review in `.10x/reviews/`. A report about one of those is welcome as a reminder, but it is already tracked.

## How to report

Use GitHub's **private vulnerability reporting**: on the repository, open the **Security** tab and choose **Report a vulnerability**. Please do not open a public issue for something exploitable. Include the version (shown by `/healthz`), what you did, what you expected, and what happened.

## What to expect

This is a personal project maintained in spare time, so there is no guaranteed response time. The aim is to acknowledge a report within a week and to fix real problems in the next release, or sooner if they are serious. Credit is given in the changelog unless you prefer otherwise.

## Supported versions

Only the latest release receives fixes. Tessera is pre-1.0, and fixes are not backported.
