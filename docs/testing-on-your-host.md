# Testing the real image on your own Docker host

The automated tests run Tessera on a CI machine. They cannot tell you how the image behaves on _your_ Docker host, behind _your_ network, with _your_ restart policy and disk. The live-image harness can. It starts a throwaway copy of Tessera on your host, checks it, and removes it. It never touches the Tessera you actually use.

This is for people who run Tessera or work on it. You do not need it to use Tessera.

## What you need

- A Docker host you can reach over SSH with a key (no password prompt), with Docker Engine and the Compose plugin. The user must be able to run `docker`.
- This repository on the machine you run the script from, with Node 24 (`npm ci` once).
- Six free ports on the host (the default is 3001 to 3006), reachable from your machine.
- About 100 MB of free memory on the host for the test instances, and, for the full-disk check, permission to mount a small memory-backed Docker volume (an unprivileged LXC with nesting turned on allows it).

## Run it

```bash
TESSERA_LIVE_SSH=you@your-docker-host npm run live:test -- --dry-run
```

The dry run prints the plan and the exact `compose.yaml` it would write, and changes nothing. Read it first. Then run it for real:

```bash
TESSERA_LIVE_SSH=you@your-docker-host npm run live:test
```

On Windows PowerShell, set the variable first: `$env:TESSERA_LIVE_SSH = 'you@your-docker-host'`.

| Option                 | What it does                                                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--image REF`          | Test this image. The default is the published image for the version in `package.json`.                                                                                                              |
| `--build`              | Build the image on the host from the committed `HEAD` and test that. This tests code that has not been released yet. Changes you have not committed are not included.                               |
| `--port N`             | The first of six consecutive ports. Default 3001.                                                                                                                                                   |
| `--live-port N`        | The port your real Tessera uses, which the harness refuses to use. Default 3000.                                                                                                                    |
| `--live-dir PATH`      | The folder of your real Tessera, only so the harness can say whether it runs the same image as the one under test. It is read, never changed.                                                       |
| `--previous-image REF` | The previous release, for the upgrade test. The default is the published `latest`, which is the previous release while the new one is still a release candidate.                                    |
| `--expect-migration`   | This release changes the database layout. Require the backup made before the upgrade, and test the rollback (the old release must refuse the upgraded database, and the backup must bring it back). |
| `--no-upgrade`         | Skip the upgrade test.                                                                                                                                                                              |
| `--soak MINUTES`       | Also run a sustained load for this long and watch memory. Four to ten minutes finds most problems.                                                                                                  |
| `--dry-run`            | Print the plan and stop.                                                                                                                                                                            |

## What it checks

1. **Start.** The image pulls (or builds), starts under your Docker, and reports healthy over the network.
2. **Hardening.** Docker really applies the settings in `compose.yaml` on your host: non-root user, read-only root filesystem, no capabilities, `no-new-privileges`, memory limit, restart policy, log rotation.
3. **Application tests** from your machine over the network: the smoke test, the security probe (with its token and host-name variants running against two more test instances, and the server logs read over SSH), and the benchmark.
4. **Backup and restore**, using the commands printed in [operations.md](operations.md) exactly as written: take a backup, check it, copy it out, restore it into a fresh volume, start a second instance, and compare the decks and card counts.
5. **Library features**, on the real image over the network: load a deck for editing, a save with its revision, the same revision refused as stale, export, a backup taken from the API and downloaded whole, the integrity check on it, a deck moved to the Trash and deleted for good with the copy taken first found inside the container, and a deck started over.
6. **Upgrade from the previous release.** The previous release is started, a deck is studied on it, then the new image takes over the same data. The deck and its progress must come through, the new routes must work, and the database must pass its integrity check. With `--expect-migration` it also requires the backup made before the upgrade, then rolls back as the operations guide says: the old release must refuse the upgraded database, and putting the backup back must bring the old release up again with the deck as it was.
7. **A hard kill and a graceful stop.** A grade is saved, the container is killed (`SIGKILL`), Docker restarts it, and the grade must still be there. Then a graceful stop must exit cleanly and quickly, and the grade must survive that too.
8. **A full disk**, on an 8 MB memory-backed volume (never your real disk): imports must fail with a clear answer, not a crash or a dropped connection, reads must keep working, and imports must work again once space is freed.
9. **Soak**, only with `--soak`.
10. **Teardown**, always.

A check that cannot run is printed as `SKIP` with the reason. A skip is not a pass.

## How it protects your real Tessera

- It works only in the folder `~/tessera-test` (in the SSH user's home, so no root access is needed) and the Compose project `tessera-test`, and it writes a marker file there. It removes a folder only if the marker is present.
- It refuses to run on your live port, or if your live folder is, contains, or sits inside the test folder. These rules are tested, including by trying to break them.
- Every test service has its own volume. None is your live volume.
- The full-disk test uses a memory-backed volume with a hard size limit.
- Teardown always runs, even if a check fails, and again at the start of the next run if a previous one was cut short.
- It connects with `BatchMode`, so it never stops to ask for a password, and the SSH target is checked so nothing but `user@host` can reach a command line.

It does start containers and create volumes on your host. Run `--dry-run` to see exactly what.

## Reading a failure

Each line is `PASS`, `FAIL`, or `SKIP`, with detail on a failure. The harness exits 0 only when nothing failed. After a failed run, the test instance is already removed. To keep one for debugging, run the steps by hand from the printed plan.
