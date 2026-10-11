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

1. Runs the full CI workflow on that commit (type check, lint, tests, browser tests, security probe, durability check, benchmark, the container smoke test on both architectures).
2. Checks that the tag equals `package.json` `version`, and that the changelog has a section for it.
3. Builds the image for `linux/amd64` and `linux/arm64` and pushes it to GitHub Container Registry as `ghcr.io/<owner>/tessera:<version>`, plus `:<major>.<minor>` and `:latest` for stable versions only. Release candidates get only their exact tag.
4. Attaches build provenance and a software bill of materials to the image.
5. Creates a GitHub Release whose notes are the changelog section. Versions with a `-` suffix are marked as pre-releases.

To rehearse without publishing, run the workflow by hand from the Actions tab (**Run workflow**). It does everything except push the image and create the release.

## If something goes wrong

| Problem                           | What to do                                                                                                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The workflow fails before pushing | Nothing was published. Fix on `main`, delete the tag (`git push --delete origin v0.1.0 && git tag -d v0.1.0`), and tag again.                                                                                               |
| A bad version was published       | Do not move or delete the tag people may have used. Publish a fixed patch release and say what happened in the changelog. If the image is dangerous, delete that image tag in GitHub Packages and mark the release as such. |
| Users report a failed upgrade     | Point them to "Roll back" in [operations.md](operations.md). The pre-upgrade backup is made automatically.                                                                                                                  |

## What is not automated

- Choosing when to release, and writing the changelog entry.
- Enabling private vulnerability reporting on the repository (see `SECURITY.md`).
- Announcing the release.
- Scanning the image for known vulnerabilities. This is planned for the release pipeline.

## First release checklist (one time)

- [x] Create the GitHub repository and decide whether it is public. (Done 2026-10-11, public.)
- [x] Add the `LICENSE` file. (Done 2026-10-11, AGPL-3.0-only.)
- [x] Push `main` and read the first CI run end to end, including the container jobs on both architectures. (Done. Green from run #8.)
- [ ] Before the first real tag: confirm the release job is allowed to push packages. The job asks for `packages: write` itself, but a repository or organisation setting (Settings, Actions, General, Workflow permissions) can restrict it. This is the one part the rehearsal could not exercise, together with creating the GitHub Release.
- [x] Enable private vulnerability reporting (Settings, Advanced Security). (Done 2026-10-11.)
- [x] Rehearse once with **Run workflow** on a branch whose `package.json` version and changelog section match. (Done 2026-10-11 on a throwaway branch: everything except the registry push and release creation passed.)

To rehearse again, make a short-lived branch with `npm version <x.y.z-rc.n> --no-git-tag-version` and a matching `## [<version>]` changelog section, push it, run the workflow on it from the Actions tab, and delete the branch afterwards.
