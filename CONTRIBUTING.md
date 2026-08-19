# Contributing to json-render-astryx

This guide covers local validation, npm trusted publisher setup, and the
tag-driven release procedure for later versions.

## Prerequisites

| Tool | Version |
| --- | --- |
| Node.js | 22.14.0 |
| npm | 11.5.1 |
| pnpm | 10.23.0 |

## Local validation

Run these from the repository root before opening a pull request:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm --filter json-render-astryx exec npm pack --dry-run --json
```

The dry run lists the tarball contents. Expect `README.md`, `package.json`, and
the built `dist/` outputs, with no `src`, workspace files, or generated `.tgz`.

## Default-branch preflight

Run this preflight before every release tag. It resolves origin's real default
branch, brings it local, fast-forwards to the remote tip, and refuses to
continue unless the checkout is clean and identical to the remote, so no tag
ever inherits an arbitrary or stale `HEAD`.

```bash
DEFAULT_BRANCH="$(git remote show origin | sed -n 's/.*HEAD branch: //p')"
git fetch origin "+refs/heads/${DEFAULT_BRANCH}:refs/remotes/origin/${DEFAULT_BRANCH}"
git switch "${DEFAULT_BRANCH}"
git merge --ff-only "origin/${DEFAULT_BRANCH}"
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(git rev-parse "origin/${DEFAULT_BRANCH}")"
```

The two `test` commands are gates. The first fails if the working tree or index
has any pending change; the second fails unless local `HEAD` matches
`origin/${DEFAULT_BRANCH}` exactly. Resolve any failure before continuing.

## Bootstrap publication status

`json-render-astryx@0.1.0` was manually published on 2026-08-18. The one-time
bootstrap is complete; do not repeat it and do not create or push a `v0.1.0`
tag.

## Configure the npm trusted publisher

Open the package on npmjs.com, then go to Settings and add a GitHub Actions
trusted publisher with these values:

| Field | Value |
| --- | --- |
| Organization or user | `howlowck` |
| Repository | `json-render-astryx` |
| Workflow filename | `publish.yml` |
| Environment | leave blank |
| Allowed action | `npm publish` |

No npm token is stored in GitHub. Trusted publishing issues short-lived
credentials at run time and generates provenance automatically. GitHub can
hold an npm automation token as a secret for other purposes, but this release
process uses none; do not add an npm publishing token to this repository.

## Subsequent releases (tag-driven, tokenless)

> **Automated publishing is currently disabled.** The release workflow in
> `.github/workflows/publish.yml` is fully commented out, so pushing a version
> tag today starts no GitHub Actions run and publishes nothing. Before you
> create or push any release tag, a maintainer must restore the workflow in a
> reviewed change and confirm the repository's GitHub Actions tab lists the
> `Publish json-render-astryx` workflow. Do not tag a release until both are
> done.

After the trusted publisher exists and the workflow is restored, each release is
a pushed version tag. The workflow in `.github/workflows/publish.yml` checks out
the tag, verifies it equals `v` plus the manifest version, runs the workspace
gates, and publishes without a token.

1. Choose a semantic version bump. Run one of these inside
   `packages/json-render-astryx`:

   ```bash
   npm version patch --no-git-tag-version
   npm version minor --no-git-tag-version
   npm version major --no-git-tag-version
   ```

   `--no-git-tag-version` edits only the manifest so the version change lands
   through a reviewed pull request instead of a local tag.

2. Refresh the lockfile only when the bump actually changes it. The
   `packages/json-render-astryx` importer in `pnpm-lock.yaml` records dependency
   specifiers but not the package's own version, so a version-only bump normally
   leaves the lockfile untouched. Run the refresh and include the result only
   when it produces a change:

   ```bash
   pnpm install --lockfile-only
   ```

3. Validate locally:

   ```bash
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm --filter json-render-astryx exec npm pack --dry-run --json
   ```

4. Open a pull request with the manifest version change and any lockfile
   update the bump produced, then merge it to the default branch.

5. Confirm `.github/workflows/publish.yml` is restored and active before running
   the tag commands below: the GitHub Actions tab must list the
   `Publish json-render-astryx` workflow. A tag pushed while the workflow stays
   commented out publishes nothing and leaves an inert tag behind. Then run the
   [default-branch preflight](#default-branch-preflight) again so the tag lands
   on a clean default branch whose local `HEAD` equals the remote default-branch
   tip, derive the version, and create a matching annotated tag:

   ```bash
   VERSION="$(node -p "require('./packages/json-render-astryx/package.json').version")"
   git tag -a "v${VERSION}" -m "json-render-astryx v${VERSION}"
   git push origin "v${VERSION}"
   ```

6. Push one release tag at a time. The workflow has no concurrency group,
   because GitHub keeps at most one pending run per group and would silently
   drop an older pending tagged release. Pushing tags one at a time gives every
   immutable version its own publish attempt.

7. Verify the release against the public registry before starting another tag:

   ```bash
   NPM_REGISTRY="https://registry.npmjs.org/"
   test "$(npm view json-render-astryx@${VERSION} version --registry="${NPM_REGISTRY}")" = "${VERSION}"
   ```

   - The Actions run for the tag must finish green.
   - The command above must print no error and confirm the exact version on the
     public registry.

   Wait for both the green Actions run and this exact-version match on the public
   registry before pushing the next release tag.

## Immutable versions and recovery

Every published npm version is permanent; it cannot be overwritten or reused.

| Situation | What happens | Recovery |
| --- | --- | --- |
| Tag pushed while the publish workflow is disabled | `.github/workflows/publish.yml` is commented out, so no Actions run starts and nothing is published; the pushed tag is inert | Leave the inert tag in place; pushed tags are immutable. Restore the workflow in a reviewed change and confirm GitHub Actions lists `Publish json-render-astryx`, bump to a new version, merge, then push a new matching version tag. Never delete or move the inert tag. |
| Tag does not match the manifest version | The verify step fails before install, tests, or publish | Leave the pushed tag in place; pushed tags are immutable. Correct the manifest version on the default branch through a reviewed change, then push a new matching version tag. Never delete or move the pushed tag. |
| Install, typecheck, test, or build fails | The workflow stops before publish and nothing is published | Fix the failure on the default branch, bump the version, refresh the lockfile only if the bump changes it, then push a new matching version tag |
| npm OIDC or registry failure | The version stays unpublished and the error appears in the workflow log | Before rerunning, query the exact version on the public registry with `npm view json-render-astryx@${VERSION} version --registry=https://registry.npmjs.org/`. If it returns the version, the publish already succeeded; do not rerun. If it returns `E404`, fix the trusted-publisher or registry configuration and rerun the same unchanged tag's workflow. Never delete or move the tag. |
| Version already published | npm rejects the duplicate `npm publish` | Bump to a new version, refresh the lockfile only if the bump changes it, merge, and push a new matching version tag |
