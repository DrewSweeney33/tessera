# Troubleshooting

Start with what you see. Every message quoted here is exactly what the app prints. For container and database problems (the container restarts, the database is "damaged" or "locked", the disk is full) the table in [operations.md](operations.md#when-something-is-wrong) lists each message and what to do.

## I cannot reach Tessera

| You see                                                  | Likely cause                                                   | Do this                                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| The browser says it cannot connect                       | The container is stopped, or the address or port is wrong      | `docker compose ps`, then `docker compose logs --tail 50 tessera`                                                 |
| `This server does not answer to the host name "…"` (421) | You reached it by a real domain name it was not told about     | Add the name to `TESSERA_ALLOWED_HOSTS` ([deploy.md](deploy.md#host-names-protection-against-dns-rebinding))      |
| The page works on the host but not from your phone       | The port is published on `127.0.0.1` only (the default)        | Use a private network or a reverse proxy ([deploy.md](deploy.md#reaching-it-from-your-phone-or-another-computer)) |
| The installed app shows "Tessera needs your server"      | The server is stopped, or you are off your VPN or home network | Start it or reconnect, then press Try again. Nothing is lost; your progress is kept on the server                 |

## A script gets 401

When `TESSERA_API_TOKEN` is set, a script must send `Authorization: Bearer <token>`. The web page does not need it. See [deploy.md](deploy.md#the-api-token-for-scripts-not-for-the-web-page).

## An import is refused

The preview names the card and the field that is wrong. Fix that card and import again; nothing was saved. The limits are 5 MB and 5,000 cards per file, so split a bigger deck. The deck format is in [deck-format.md](deck-format.md), and [claude-workflow.md](claude-workflow.md) shows how to ask Claude to fix an error list.

## The page looks stale after an upgrade

Tessera does not cache pages or data in your browser, so a reload shows the new version. If an old screen persists, hard-reload (Ctrl+Shift+R, or Cmd+Shift+R). On an installed app, close it and open it again. If you still see the old version, check which image the container runs: `docker compose images`.

## The upgrade failed or I want to go back

Tessera writes `pre-migrate-<time>.db` in `/data/backups` before it changes the database. Going back to an older version means restoring that file first, because an older version refuses a newer database. Follow "Roll back" in [operations.md](operations.md#roll-back).

## Install as an app is not offered

- Browsers offer Install only on a secure address: `https://…` or `localhost`. At a plain `http://192.168…` address there is no Install, no offline page, and everything else works as usual. Put Tessera behind HTTPS (a reverse proxy) to install it.
- In Chrome and Edge the Install button is in the address bar. On an iPhone or iPad use Share, then Add to Home Screen. Firefox on desktop does not install web apps.
- After you add it, the app opens in its own window with no address bar.
- To remove it, use the browser or the phone's normal way of uninstalling an app. Your decks are on the server and are not affected.

## My cards are not what I expect

| You see                                            | It means                                                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A card you just answered shows again as "Learning" | Normal. After "Good" on a new card the next step is minutes away                                                                                                 |
| "That card was already answered somewhere else"    | You studied in two tabs or devices at once. It moved on to the next card                                                                                         |
| Reviews due today are fewer than the deck's total  | The daily limits on the Settings page cap new cards and reviews per day                                                                                          |
| A card is missing from a session                   | It may be set aside (suspended) from the Leeches page, buried until tomorrow (another blank of the same cloze card was just answered), or in a deck in the Trash |
| Practice answers do not change when a card is due  | By design. Practice again never changes the schedule and is not counted in the statistics                                                                        |

## Still stuck

Search the logs for the `requestId` in the `x-request-id` response header, then look at the line with `"level":"error"` (`docker compose logs tessera`). If it looks like a bug, open an issue and include the version (`/healthz`), what you did, and that log line with any private text removed. A security problem goes through [SECURITY.md](../SECURITY.md).
