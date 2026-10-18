# Security Policy

## How Tessera is meant to be run

Tessera is a single-user app. **A login is optional and off by default**: set `TESSERA_PASSWORD` and every page and API route asks for it (see [docs/deploy.md](docs/deploy.md)). It is meant to run on `127.0.0.1`, on a private network such as a VPN, or behind a reverse proxy with HTTPS, and with a password on any network you do not fully control. The deployment guide explains each option. Reaching a Tessera that has no password set over a network is not a vulnerability in Tessera, because running without a login is the documented default. A way around the login when a password **is** set is a vulnerability, and is in scope below.

## What to report

Please report anything that breaks a protection Tessera does claim:

- Script running from card content (cross-site scripting), or a way around the Markdown sanitizing.
- A web page on another site being able to read or change data in a Tessera that is only reachable on `localhost` or a private address (cross-site request forgery, DNS rebinding).
- A way to get the server to read or write files outside its data folder, run commands, or reach other hosts.
- A crash or hang caused by a crafted deck or request.
- A way to read or change data, or reach any page or API route other than the ones documented as open, without the password when `TESSERA_PASSWORD` is set (including a forged or reused login cookie, or a way to skip the slow-down on wrong guesses).
- A secret, a password, a login cookie, or card content appearing in logs.
- A vulnerable dependency that the published image actually uses.

The current known gaps are listed in the security review in `.10x/reviews/`. A report about one of those is welcome as a reminder, but it is already tracked.

## How to report

Use GitHub's **private vulnerability reporting**: on the repository, open the **Security** tab and choose **Report a vulnerability**. Please do not open a public issue for something exploitable. Include the version (shown by `/healthz`), what you did, what you expected, and what happened.

## What to expect

This is a personal project maintained in spare time, so there is no guaranteed response time. The aim is to acknowledge a report within a week and to fix real problems in the next release, or sooner if they are serious. Credit is given in the changelog unless you prefer otherwise.

## Supported versions

Only the latest release receives fixes. Tessera is pre-1.0, and fixes are not backported.
