# Deploying Tessera

Tessera is one container with one SQLite file. This page covers running it, reaching it from other devices safely, and the choices that matter. Day-to-day care (backups, upgrades, fixing problems) is in [operations.md](operations.md).

## Requirements

|         |                                                                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker  | Docker Engine 24 or newer with the Compose plugin (v2), or Docker Desktop                                                                                             |
| CPU     | 64-bit x86 or ARM. The image is built for `linux/amd64` and `linux/arm64`, so a Raspberry Pi with a 64-bit OS works                                                   |
| Memory  | About 250 MB in use, up to about 315 MB under heavy load. Allow 512 MB                                                                                                |
| Disk    | The image is built to stay under 150 MB compressed (the pipeline fails if it does not). The database is about 55 MB for 5,000 cards and five years of heavy reviewing |
| Browser | A current Chrome or Edge (123 or newer), Firefox 120 or newer, or Safari 17.5 or newer. Every change is tested in Chrome, Firefox, and WebKit, the engine of Safari   |

## Start it

```bash
git clone <this repository>
cd tessera
docker compose up -d --build
docker compose ps
```

`docker compose ps` should show the service as `healthy` within about 30 seconds. Then open <http://localhost:3000>.

You can also check from a terminal:

```bash
curl -s http://127.0.0.1:3000/healthz
```

A healthy server answers `{"ok":true,"version":"...","dbOk":true}`.

## Reaching it from your phone or another computer

**Tessera has no login.** Anyone who can reach the port can read and change everything, so the way you reach it matters more than any setting. `compose.yaml` publishes the port on `127.0.0.1` only, so out of the box only the machine it runs on can use it. Pick one of these to go further, in this order of preference.

### 1. A private network such as Tailscale or WireGuard (simplest)

Install the VPN on the host and on your devices, then publish the port on the VPN address only. In `compose.yaml`, change the port line to the host's VPN address (`tailscale ip -4` shows it):

```yaml
ports:
  - '100.64.0.10:3000:3000'
```

Nothing outside the VPN can connect. No password prompt is needed because only your devices are on that network.

### 2. A reverse proxy that asks for a password

Keep the loopback mapping and put a proxy in front that handles HTTPS and authentication. Example for Caddy (an illustration, not tested here):

```text
tessera.example.com {
	basic_auth {
		andrew <password hash from: caddy hash-password>
	}
	reverse_proxy 127.0.0.1:3000
}
```

Behind a proxy that terminates HTTPS, uncomment these two lines in `compose.yaml` so Tessera sees the real address:

```yaml
PROTOCOL_HEADER: x-forwarded-proto
HOST_HEADER: x-forwarded-host
```

Use a strong, unique password. Also keep the proxy and Tessera on the same machine so port 3000 itself is never exposed.

### 3. Open to your whole home network (only if you trust every device on it)

Change the mapping to `'3000:3000'`. Everyone on the network, including a guest's phone or a compromised smart TV, can then read and change your decks. Not recommended.

**Never expose it to the internet without a proxy that requires authentication.**

### Host names (protection against DNS rebinding)

A hostile web page can make your browser attack a service on your own network by pointing a domain it controls at your server's address. To the browser that looks like the page talking to itself, so the usual cross-site protections do not apply. What the page cannot fake is the host name it arrived under, which is always its own domain. So Tessera only answers to names it is meant to be reached by, and refuses the rest with a `421` reply that says how to fix it.

Without any setting, Tessera answers:

- `localhost` and any name ending in `.localhost`
- any IP address (`192.168.30.99`, `[::1]`)
- single-word names such as `tessera` or `nas`
- names ending in `.local`, `.lan`, `.home.arpa`, `.internal`, or `.localdomain`

Those names cannot exist on the public internet, so an attacker cannot point one at you.

**If you reach Tessera by a real domain name, you must list it.** That includes a reverse proxy name like `tessera.example.com`, even when the name only resolves inside your home network, because a rebinding page can use a real domain too. In `compose.yaml`, under `environment`:

```yaml
TESSERA_ALLOWED_HOSTS: tessera.example.com
```

You can list several names separated by commas, add a port (`box.example.com:8443`), or allow everything under a domain with `*.example.com`. When the setting is present, only the listed names are answered, plus `localhost` and IP addresses. The startup log says which rules are in force. If a page shows `This server does not answer to the host name "…"`, this setting is what it means.

This does not decide who may connect. Anyone who can reach the port can still use Tessera, so options 1 and 2 above still apply. `/healthz` always answers, under any name, so monitors and the Docker health check keep working.

### The API token (for scripts, not for the web page)

Setting `TESSERA_API_TOKEN` makes the API demand a password, but only from callers that are not the Tessera web page. It is for scripts and tools that call `/api/*` from outside the browser, such as something that imports decks for you.

Make a token of at least 24 characters, for example `openssl rand -hex 32`, and put it in `compose.yaml`:

```yaml
environment:
  TESSERA_API_TOKEN: put-your-long-random-value-here
```

A script then sends it in a header:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://tessera.lan:3000/api/decks
curl -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: text/markdown" --data-binary @deck.md http://tessera.lan:3000/api/import
```

Without it the answer is `401` and a message that says what to send. `/healthz` and `/api/schema` never need it. The startup log says when a token is set, and never prints it, nor does any other log line.

**What it does:** stops scripts and tools that do not pretend to be the web page, and stops other websites from using a visitor's browser to reach your Tessera.

**What it does not do:** it does not protect the web page. Tessera has no login, so anyone who can open the page in a browser can use it, and a script that copies what the page sends can use the API too. The token is not a replacement for options 1 and 2 above. If other people or devices on your network should not use your Tessera, keep it behind a private network or a reverse proxy that asks for a password.

How the page is recognised: the browser says so itself (`Sec-Fetch-Site: same-origin`, or an `Origin` header that names this server), or, over plain HTTP on a network address where browsers send neither, a header that only the page itself can send. See [ADR-011](../.10x/adrs/011-recognizing-the-web-page-for-the-api-token.md).

Two things to know:

- If a reverse proxy in front of Tessera uses **HTTP Basic** authentication, it uses the same `Authorization` header, so a script cannot send both. Point scripts at Tessera directly (for example on the private network) instead of through that proxy.
- If you open an API address directly in a browser tab (for example `/api/decks`), the browser identifies it as typed in, so it needs the token. The web pages themselves are not affected.

## Settings you may want to change

Edit `compose.yaml`, then run `docker compose up -d`.

| Setting                           | Why                                                                                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TZ`                              | **Set this.** It decides when a study day rolls over (04:00 local time). The default is UTC, which makes the day change at odd hours elsewhere. Use a name like `America/Chicago`. |
| The left side of the port mapping | If port 3000 is taken, use for example `127.0.0.1:3100:3000`.                                                                                                                      |
| `TESSERA_API_TOKEN`               | Optional. Makes scripts send a password to use the API. Does not protect the web page. See "The API token" above.                                                                  |
| `LOG_LEVEL`                       | `debug`, `info` (default), `warn`, or `error`.                                                                                                                                     |
| `TESSERA_ALLOWED_HOSTS`           | **Set this if you use a real domain name**, for example a reverse proxy address. See "Host names" above.                                                                           |
| `mem_limit: 512m`                 | Optional cap, under the service. Tessera uses about 60 percent of this at its busiest.                                                                                             |

`TESSERA_ALLOWED_HOSTS` and `TESSERA_API_TOKEN` are described above. The token appears in the file as a comment.

## Where the data lives

By default, in a Docker named volume called `<folder>_tessera-data`, mounted at `/data` in the container. The database is `/data/tessera.db`, with automatic pre-upgrade copies in `/data/backups/`.

To keep the data in a folder you choose, replace the volume line with a bind mount, and make the folder writable by the container's user (id 1000):

```yaml
volumes:
  - /srv/tessera:/data
```

```bash
sudo mkdir -p /srv/tessera && sudo chown 1000:1000 /srv/tessera
```

If the folder is not writable, Tessera refuses to start and tells you the exact `chown` command to run.

## What the container does for safety

Runs as a normal user (not root), with a read-only filesystem apart from `/data` and `/tmp`, no extra Linux capabilities, and `no-new-privileges`. It restarts itself after a crash. Docker marks it unhealthy if the database stops answering.

## Stop, remove, or start over

| Goal                                                | Command                  |
| --------------------------------------------------- | ------------------------ |
| Stop                                                | `docker compose stop`    |
| Start                                               | `docker compose start`   |
| Remove the container but keep your data             | `docker compose down`    |
| **Delete everything, including your study history** | `docker compose down -v` |

Take a backup first (see [operations.md](operations.md)) if there is any chance you want the data again.
