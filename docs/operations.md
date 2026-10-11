# Operating Tessera

How to check on it, back it up, upgrade it, roll it back, and fix it when it breaks.

**What was tested.** The behaviour and every error message below were produced by running the real server: backup under live writes, restore, a damaged and a truncated database, an upgrade-then-rollback, bad settings, an unwritable folder, a busy port, and two copies on one folder. The backup command is run by `npm run ops:check` exactly as written here, so this page cannot drift from the code. **What was not.** The `docker compose` wrappers around those commands could not be run, because the machine this was written on has no Docker. They are standard, but run through them once on your own host before you need them. The disk-full message comes from the code and was not triggered.

Commands assume the Docker Compose setup from [deploy.md](deploy.md), run from the folder holding `compose.yaml`. The service is called `tessera` and its data lives in the volume mounted at `/data`.

## At a glance

| Question                     | Command                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| Is it up and healthy?        | `docker compose ps` (look for `healthy`)                                                         |
| Does it answer?              | `curl -s http://127.0.0.1:3000/healthz`                                                          |
| Which version?               | the `version` field of that `/healthz` reply                                                     |
| What is it saying?           | `docker compose logs --tail 100 tessera`                                                         |
| Only the errors              | `docker compose logs --no-log-prefix tessera \| jq -R -c 'fromjson? \| select(.level=="error")'` |
| One request, start to finish | search the logs for its `requestId`. It is also the `x-request-id` response header.              |

`/healthz` answers 200 with `{"ok":true,"version":"...","dbOk":true}` when the database responds, and 503 when it does not. Logs are one JSON object per line on stdout. They never contain card text, typed answers, or tokens.

## What "working" means

For one person running this at home, three things matter. These are the targets the design was tested against.

| Target                                                                                                 | Measured                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No lost grades.** A grade the app has acknowledged is never lost by a restart or a crash of the app. | Verified with hard kills right after an acknowledged grade. A power cut or OS crash can lose the last few commits, never corrupt the file (WAL with `synchronous = NORMAL`). |
| **Fast enough to not notice.** 95 percent of API calls under 250 ms.                                   | About 10 to 15 ms, even with 5,000 cards and 200,000 review records (about five years of heavy use).                                                                         |
| **Recoverable.** A bad upgrade or a damaged disk costs at most the time since the last backup.         | An automatic backup is made before every schema upgrade. Restoring a 5,000 card database with 200,000 reviews takes about a second.                                          |

Availability is not a target. It is a study tool. If it is down for an hour, nothing is lost.

## Resource use

Measured on a 5,000 card deck with 200,000 review records: about 200 to 250 MB of memory when idle, rising to about 315 MB under sustained heavy traffic and then staying flat (a 3 minute test of 140 requests a second showed no growth). The database file is 55 MB and a start takes about one second. Allow 512 MB.

## Backups

Two kinds exist.

**Automatic, before upgrades.** When a new version changes the database layout, Tessera first writes a full copy to `/data/backups/pre-migrate-<timestamp>.db`. Nothing prunes this folder, so delete old ones when you are happy with an upgrade.

**Manual, whenever you like, while Tessera keeps running.** This takes a consistent snapshot and is safe during studying. It takes under a second for a large deck.

<!-- backup-command -->

```bash
docker compose exec tessera node -e "const D=require('better-sqlite3');const d=new D(process.argv[1],{readonly:true,fileMustExist:true});d.prepare('VACUUM INTO ?').run(process.argv[2]);d.close()" /data/tessera.db /data/backups/manual-$(date +%F-%H%M).db
```

Then copy it off the machine, for example:

```bash
docker compose cp tessera:/data/backups/. ./tessera-backups/
```

A backup you have not copied elsewhere does not protect you from losing the disk.

Check a backup is sound (prints `ok`):

```bash
docker compose exec tessera node -e "const D=require('better-sqlite3');const d=new D(process.argv[1],{readonly:true});console.log(d.pragma('integrity_check',{simple:true}))" /data/backups/manual-2026-10-11-0900.db
```

To run it on a schedule, put the first command in a cron job or a systemd timer on the host, once a day is plenty.

**Never back up by copying `tessera.db` while Tessera is running.** Recent changes live in a side file (`tessera.db-wal`), so the copy can be missing days of study history and still look valid. In testing, such a copy of a fresh database was a 4 KB file with nothing in it. If you want a plain file copy, run `docker compose stop tessera` first, then copy the whole `/data` folder.

## Restore

1. `docker compose stop tessera`
2. Keep the damaged data, in case it is needed: `docker compose run --rm --no-deps --entrypoint sh tessera -c "mkdir -p /data/old && mv /data/tessera.db* /data/old/ 2>/dev/null; ls -la /data"`
3. Put the backup in place as `/data/tessera.db`. With a bind-mounted data folder this is a plain file copy. With a named volume, use a throwaway container: `docker run --rm -v tessera_tessera-data:/data -v "$PWD/tessera-backups":/b alpine sh -c "cp /b/manual-2026-10-11-0900.db /data/tessera.db && chown 1000:1000 /data/tessera.db"` (the volume name is the folder name plus `_tessera-data`. Check with `docker volume ls`).
4. `docker compose up -d` and check `docker compose ps`.

The restored database remembers every review it had, including the ids used to avoid double counting, so a browser tab that was open during the restore cannot record a grade twice.

## Upgrade

1. Take a manual backup (above) and copy it off the machine.
2. Get the new version: `git pull` (or check out the release tag you want).
3. `docker compose up -d --build`. This builds the new image and replaces the running container. If the new version changes the database, it writes `/data/backups/pre-migrate-...db` first.
4. Check `docker compose ps` shows `healthy`, and `curl -s http://127.0.0.1:3000/healthz` shows the new version.
5. Study one card.

Stop the old container **before** starting the new one. Two copies of Tessera can share one data folder without corrupting it, but an upgrade that changes the database while the old version is still writing can fail. `docker compose up -d` does this correctly. Do not start a second stack against the same volume by hand.

## Roll back

1. `docker compose stop tessera`
2. Start the previous version (set the image tag back, or `git checkout <previous tag> && docker compose build`).
3. If the new version had already changed the database, the old one refuses to start with this message, and changes nothing:

   > This database was written by a newer version of Tessera than the one running now. Start the newer version again, or restore the backup that was made before the upgrade (see /data/backups).

   Restore `/data/backups/pre-migrate-<timestamp>.db` as `tessera.db` (see Restore), then start the old version. Anything studied since the upgrade is not in that backup, so only roll back if the new version is truly unusable.

## When something is wrong

Every message below is exactly what the app prints.

| You see                                                                                                                     | It means                                                                                                                                                                                                                    | Do this                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container restarts over and over, log says `Invalid configuration: - PORT: ...` (or `TZ`, `LOG_LEVEL`, `TESSERA_API_TOKEN`) | An environment variable in `compose.yaml` is wrong. The message names it. `TZ` must be a name like `America/Chicago`.                                                                                                       | Fix the variable, `docker compose up -d`.                                                                                                                                   |
| `Cannot write to the data directory ... (EACCES)` or `(ENOTDIR)`                                                            | The data folder is not writable by user 1000. Common with a bind mount.                                                                                                                                                     | `chown -R 1000:1000 <folder>`, or use the named volume.                                                                                                                     |
| `The database file ... is damaged or is not a Tessera database`                                                             | The file is corrupt, truncated, or something else was put there. It was not changed.                                                                                                                                        | Restore the latest backup (above).                                                                                                                                          |
| `This database was written by a newer version of Tessera`                                                                   | You started an older version after an upgrade.                                                                                                                                                                              | Start the newer version, or restore the pre-upgrade backup (Roll back).                                                                                                     |
| `The database file ... is locked by another process`                                                                        | Something else holds the file, such as a second container on the same volume or a database tool.                                                                                                                            | Stop the other one.                                                                                                                                                         |
| `Cannot use the database file ... (SQLITE_FULL ...)`                                                                        | The disk is full.                                                                                                                                                                                                           | Free space (old `/data/backups` files are the usual culprit), then restart.                                                                                                 |
| A page or API reply says `This server does not answer to the host name "…"` (HTTP 421)                                      | You reached Tessera by a real domain name, such as a reverse proxy address, that it was not told about. Names like that are refused on purpose, because a hostile web page can use one to attack a service on your network. | Add the name to `TESSERA_ALLOWED_HOSTS` in `compose.yaml` (for example `tessera.example.com`, or `*.example.com`), then `docker compose up -d`. See [deploy.md](deploy.md). |
| `listen EADDRINUSE`                                                                                                         | Another program already uses port 3000.                                                                                                                                                                                     | Change the left side of the port mapping in `compose.yaml`, for example `127.0.0.1:3100:3000`.                                                                              |
| Browser shows "Cannot reach the Tessera server"                                                                             | The container is stopped, or the address is wrong.                                                                                                                                                                          | `docker compose ps`, then `docker compose logs --tail 50 tessera`.                                                                                                          |
| Import says the deck is "larger than 5 MB" or has "5000 cards"                                                              | Limits.                                                                                                                                                                                                                     | Split it into several decks.                                                                                                                                                |
| A card you just answered shows again as "Learning"                                                                          | Normal. After "Good" on a new card the next step is minutes away, and with nothing else due the card is offered again rather than ending the session.                                                                       | Nothing. Use "Easy" to graduate a card at once.                                                                                                                             |
| "That card was already answered somewhere else"                                                                             | You studied in two tabs or on two devices at once.                                                                                                                                                                          | Nothing. It moved on to the next card.                                                                                                                                      |

If the app looks fine but a page returns an error, search the logs for the `requestId` shown in the `x-request-id` response header, then look at the line with `"level":"error"`.

## Things to know

- **A system clock that jumps backwards** (a virtual machine resuming, a time sync) used to be able to make a just-answered card unanswerable until the clock caught up. This is fixed, and a test covers it.
- **Power loss.** The database uses write-ahead logging with `synchronous = NORMAL`. After a power cut or operating system crash it opens cleanly, but the last few seconds of grades can be missing. An application crash or `docker kill` does not lose acknowledged grades.
- **Disk full.** Reads keep working. Writes fail with an error and nothing is half-saved.
- **One data folder, one running Tessera.** Two at once will not corrupt anything, but the second one's writes wait for the first, and an upgrade can fail.
- **Settings** (daily limits, retention) have defaults of 20 new cards, 200 reviews, 90 percent retention, and a 04:00 day rollover. A settings screen arrives in a later release.
