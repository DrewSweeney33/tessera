# Releasing Tessera

How a version gets from `main` to a published image. Written for the maintainer. Nothing here publishes anything until a version tag is pushed, and pushing a tag is always a deliberate act.

## Versioning

[Semantic Versioning](https://semver.org). While the version starts with `0.`, minor releases may change things, and the changelog says so.

| Change                                                         | Bump                                 |
| -------------------------------------------------------------- | ------------------------------------ |
| Bug fixes, no behaviour change                                 | patch                                |
| New features, compatible deck format and database              | minor                                |
| Deck format or database change that older versions cannot read | minor while `0.x`, major after `1.0` |

The database is migrated forward automatically with a backup first. It is **not** migrated backward: an older version refuses to open a newer database (see [operations.md](operations.md), "Roll back"). Any release that adds a migration must say so in the changelog, because it changes what rolling back means.

Release plan: `v0.1.0` at the end of Milestone 2, `v1.0.0` at the end of Milestone 5. Candidates use a suffix, for example `v0.1.0-rc.1`.

## Before tagging

All of this must be true on `main`:

- [ ] CI is green on the commit you will tag. The release workflow runs the same checks again and stops if they fail.
- [ ] `CHANGELOG.md` has a section for the version, with the date. Move entries from `[Unreleased]` into it.
- [ ] `package.json` `version` equals the version you are releasing. The app reports this in `/healthz`. Run `npm version <version> --no-git-tag-version`, which also updates the lockfile.
- [ ] The open items in `.10x/status.md` for that milestone are done or knowingly deferred, and the QA and security reviews for the milestone exist.
- [ ] `docker compose up -d --build` on a clean machine reaches `healthy` and a deck imports and studies. (The pipeline does this on every push, but a human look before a public release is worth five minutes.)
- [ ] You have read [operations.md](operations.md) once end to end after the last change to it.

## Publishing

```bash
git checkout main && git pull
git tag -a v0.1.0 -m "Tessera 0.1.0"
git push origin v0.1.0
```

Pushing the tag starts `.github/workflows/release.yml`, which:

1. Runs the full CI workflow on that commit (type check, lint, tests, browser tests in Chrome, Firefox, and WebKit, security probe, durability check, benchmark, a vulnerability scan of the image, and the container smoke test on both architectures).
2. Checks that the tag equals `package.json` `version`, and that the changelog has a section for it.
3. Builds the release files (see below) and checks them twice: against their checksums, and by reading the skill zip back with a separate unzip program.
4. Builds the image for `linux/amd64` and `linux/arm64` and pushes it to GitHub Container Registry as `ghcr.io/<owner>/tessera:<version>`, plus `:<major>.<minor>` and `:latest` for stable versions only. Release candidates get only their exact tag.
5. Attaches build provenance and a software bill of materials to the image.
6. Creates a GitHub Release whose notes are the changelog section, with the release files attached. Versions with a `-` suffix are marked as pre-releases.

To rehearse without publishing, run the workflow by hand from the Actions tab (**Run workflow**). It does everything except push the image and create the release, including building and checking the release files.

## The release files

Every release carries three files next to the image. They are built by `scripts/package-release-assets.ts`, which reads only files in this repository and can be run by hand to see exactly what would be attached:

```bash
node scripts/package-release-assets.ts --out release-assets --version 0.1.0
```

| File                               | What it is                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `tessera-deck.v1.schema.json`      | The JSON Schema of the deck format, the same file the server gives at `/api/schema`.                                              |
| `tessera-deck-skill-<version>.zip` | The Claude skill (`claude-skill/tessera-deck`), as a zip with the folder `tessera-deck/` at its root, ready to upload as a skill. |
| `SHA256SUMS`                       | A checksum for each file. After downloading all three into one folder, `sha256sum -c SHA256SUMS` checks them.                     |

The zip is reproducible: building it twice gives identical bytes, with no date inside, so anyone can rebuild it from the tagged source and compare checksums.

## The image scan

The CI workflow scans the built image with Trivy for known vulnerabilities in the operating system packages and in the npm packages that ship in it. It fails on anything rated **high or critical that has a fix available**, so a failure always asks for something that can be done. The release workflow runs CI first, so a release cannot go out with such a finding.

It runs as two steps so a failure says what kind it is. **Scan the image** runs Trivy and writes `trivy-results.json`. It fails only if the scanner itself cannot run, for example if it cannot download its vulnerability database (a tool problem, usually gone on a re-run). **Check the scan result** (`scripts/check-image-scan.ts`) reads that file, prints every finding, writes each as a GitHub annotation on the run page, and fails on high or critical findings with a fix. It also fails if the scan looked at nothing, so a pass always means something was really scanned, and it prints what it looked at.

## If something goes wrong

| Problem                           | What to do                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The workflow fails before pushing | Nothing was published. Fix on `main`, delete the tag (`git push --delete origin v0.1.0 && git tag -d v0.1.0`), and tag again.                                                                                                                                                                                                                                                                            |
| A bad version was published       | Do not move or delete the tag people may have used. Publish a fixed patch release and say what happened in the changelog. If the image is dangerous, delete that image tag in GitHub Packages and mark the release as such.                                                                                                                                                                              |
| The image scan fails              | Read the table in the job log. For an operating system package, rebuilding picks up the newest base image, which is usually the whole fix. For an npm package, update that dependency. If a finding has no fix, it is not reported, by design. If a fixable finding is a false alarm for this app, record why in the changelog before adding an exception, and keep the exception as narrow as possible. |
| Users report a failed upgrade     | Point them to "Roll back" in [operations.md](operations.md). The pre-upgrade backup is made automatically.                                                                                                                                                                                                                                                                                               |

## What is not automated

- Choosing when to release, and writing the changelog entry.
- Enabling private vulnerability reporting on the repository (see `SECURITY.md`).
- Announcing the release.
- Reading a failed image scan and deciding what to do about it.
- Checking that the repository allows the release job to push packages (see the checklist below).

## First release checklist (one time)

- [x] Create the GitHub repository and decide whether it is public. (Done 2026-10-11, public.)
- [x] Add the `LICENSE` file. (Done 2026-10-11, AGPL-3.0-only.)
- [x] Push `main` and read the first CI run end to end, including the container jobs on both architectures. (Done. Green from run #8.)
- [ ] The first CI run that includes the image scan step is green. (It has never run: no container program was available when it was added, so it was only checked by reading.)
- [ ] Run the release workflow by hand once with the new asset step, and check the log shows both checks passing.
- [ ] Before the first real tag: confirm the release job is allowed to push packages. The job asks for `packages: write` itself, but a repository or organisation setting (Settings, Actions, General, Workflow permissions) can restrict it. This is the one part the rehearsal could not exercise, together with creating the GitHub Release.
- [x] Enable private vulnerability reporting (Settings, Advanced Security). (Done 2026-10-11.)
- [x] Rehearse once with **Run workflow** on a branch whose `package.json` version and changelog section match. (Done 2026-10-11 on a throwaway branch: everything except the registry push and release creation passed.)

To rehearse again, make a short-lived branch with `npm version <x.y.z-rc.n> --no-git-tag-version` and a matching `## [<version>]` changelog section, push it, run the workflow on it from the Actions tab, and delete the branch afterwards.
