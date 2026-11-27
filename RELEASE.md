# Release

How to ship a new version of RemoteControl. The mechanism is deliberately plain: a release is a git branch named
`release_<version>` whose `package.json` carries that version, and the host machine pulls it through the
**Self-update** panel on the Settings page. There are no archives, no package registry, no manual deploy steps.
The mechanism itself (what the runner does, restart modes, limits) is documented in
[SETUP.md - Self-update](SETUP.md#6-self-update); this file is only the step-by-step procedure.

## Before you release

- [ ] You are on `main` and it is up to date: `git checkout main && git pull --ff-only`.
- [ ] The working tree is clean: `git status` shows nothing to commit (the tree must also be clean on the **host**,
      or `git pull --ff-only` there will refuse to move).
- [ ] Everything passes:

      npm run typecheck
      npm run test
      npm run build

- [ ] Pick the next version. Branches are compared as versions, never as strings (`release_0.10` is newer than
      `release_0.9`), and the host only offers branches **strictly higher** than its running
      `package.json` version. Use semver: patch for fixes, minor for features, major for breaking changes
      (config migrations, removed endpoints - mention them in the release notes below).

## Publish

```bash
# 1. Bump the version, commit and tag it (creates the v<version> tag and a "release v<version>" commit).
npm version 0.7.4 -m "release v%s"

# 2. Cut the release branch named after the full version.
git branch release_0.7.4

# 3. Push the branch and the tag.
git push origin main --follow-tags
git push origin release_0.7.4
```

Branch naming must satisfy `update.release_pattern` (default `^release_(\d+\.\d+(?:\.\d+)?)$`): `release_0.8` and
`release_0.8.1` are both valid, but this repository's convention is the **full version**, matching the tag.
Check what the host will see with `git ls-remote --heads origin 'refs/heads/release_*'`.

## Deploy on the host

1. Open the dashboard and go to **Settings**. The *Self-update* panel on the left is the readout; the
   *Update actions* block under *Controls* on the right holds the buttons.
2. Press **Check for updates** - the new release branch should be listed as the target.
3. Press **Update now**. The runner works in its own process; watch the steps in the panel, in `logs/update.log`
   on the host, or in `data/update-status.json`.
4. The page reloads itself once the new server answers.

What runs under the hood: `git fetch`, `git checkout release_<version>`, `git pull --ff-only`,
`npm install` (only when manifests changed), `npm run build`, restart. Never a merge - a diverged history stops
the update instead of creating a merge commit.

## Verify

- [ ] The footer of every page shows the new version: `v0.7.4`.
- [ ] The Self-update panel reports the run as successful and shows the new version.
- [ ] Smoke-check the app: sign in, dashboard metrics stream, service start/stop, a second account if roles changed.
- [ ] If the release touched `config/`, compare the host's `config/config.yaml` with
      `config/config.yaml.example` for new or renamed keys.

## Rollback

There is no one-click rollback. To go back, move the host checkout onto the previous release branch and rebuild:

```bash
# on the host, in the checkout
git checkout release_0.7.3
npm install && npm run build
systemctl --user restart remotecontrol   # or however the server is started
```

The next `Check for updates` will only offer branches higher than the running version, so rolling back by hand
also re-arms the forward update to the newer branch.

## Troubleshooting

The panel errors and their fixes are tabulated in [SETUP.md](SETUP.md). The most common on a release day:

| Symptom | Cause and fix |
| --- | --- |
| `no release branch newer than v... was found` | The branch was not pushed, its name does not match `release_pattern`, or its `package.json` version is not higher. Inspect with `git -C <root> ls-remote --heads origin`. |
| `HEAD is detached; check out a branch first` | The host runs on a detached commit: `git switch release_<current>` there, then retry. |
| `'<old>' has N local commit(s) that '<new>' does not contain` | The host checkout carries local-only work. Merge or rebase it into the new release branch, or update from a clean checkout. |

## Release notes

Keep them in the tag: `npm version` makes the commit; add the highlights with
`git tag -a v<version> -m "..."` before pushing, or edit the tag afterwards (`git tag -a -e`). A short
`changed / fixed / added` list is enough - the update panel shows the commits a run carried anyway.
