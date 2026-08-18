# Contributing to json-render-astryx

This guide covers local validation, the one-time first publish, npm trusted
publisher setup, and the tag-driven release procedure for later versions.

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

The dry run lists the tarball contents. Expect `package.json` and the built
`dist/` outputs, and no `src` or workspace files.

## Default-branch preflight

Run this preflight before the bootstrap publish and again before every release
tag. It resolves origin's real default branch, brings it local, fast-forwards
to the remote tip, and refuses to continue unless the checkout is clean and
identical to the remote, so no publish or tag ever inherits an arbitrary or
stale `HEAD`.

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

## One-time bootstrap publish (0.1.0)

`json-render-astryx@0.1.0` is not on the registry yet; `npm view
json-render-astryx` returned a 404 on 2026-08-17. npm trusted publishers can
only be configured from an existing package settings page, and OpenID Connect
publishing cannot create a package that does not exist. A maintainer publishes
`0.1.0` once from a local authenticated session, then configures the trusted
publisher for every later release.

Every npm command below pins the public registry explicitly so the bootstrap
never inherits a different registry from local configuration:

```bash
NPM_REGISTRY="https://registry.npmjs.org/"
```

1. Run the [default-branch preflight](#default-branch-preflight) so the publish
   comes from a clean, fully synchronized default-branch commit.

2. Assert the manifest version is exactly `0.1.0`:

   ```bash
   test "$(node -p "require('./packages/json-render-astryx/package.json').version")" = "0.1.0"
   ```

3. Confirm the package is absent on the public registry:

   ```bash
   npm view json-render-astryx --registry="${NPM_REGISTRY}"
   ```

   Expect an `E404` (package not found).

4. Authenticate locally against the public registry:

   ```bash
   npm login --registry="${NPM_REGISTRY}"
   ```

   Complete npm's authentication flow. On npm 11 this typically opens a browser
   to finish sign-in, though npm may fall back to an interactive terminal
   prompt. Provide your username, password, and one-time two-factor code only
   inside npm's own flow. Never commit these credentials to the repository and
   never enter them into GitHub.

5. Confirm the active identity:

   ```bash
   npm whoami --registry="${NPM_REGISTRY}"
   ```

6. Run the full local gates and inspect the dry run:

   ```bash
   pnpm install --frozen-lockfile
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm --filter json-render-astryx exec npm pack --dry-run --json
   ```

7. Publish the package workspace with public access:

   ```bash
   pnpm --filter json-render-astryx exec npm publish --access public --registry="${NPM_REGISTRY}"
   ```

8. Verify the publish landed on the public registry with the exact version:

   ```bash
   test "$(npm view json-render-astryx@0.1.0 version --registry="${NPM_REGISTRY}")" = "0.1.0"
   ```

Do not add an npm token to GitHub for this. All later releases authenticate
through trusted publishing.

> **Warning:** Do not push a `v0.1.0` tag after this bootstrap. The publish
> workflow triggers on `v*` tags and would run `npm publish` for `0.1.0` a
> second time. npm versions are immutable, so that duplicate publish fails.

## Configure the npm trusted publisher (after bootstrap)

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

After the trusted publisher exists, each release is a pushed version tag. The
workflow in `.github/workflows/publish.yml` checks out the tag, verifies it
equals `v` plus the manifest version, runs the workspace gates, and publishes
without a token.

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

5. Run the [default-branch preflight](#default-branch-preflight) again so the
   tag lands on a clean default branch whose local `HEAD` equals the remote
   default-branch tip. Then derive the version and create a matching annotated
   tag:

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
| Tag does not match the manifest version | The verify step fails before install, tests, or publish | Leave the pushed tag in place; pushed tags are immutable. Correct the manifest version on the default branch through a reviewed change, then push a new matching version tag. Never delete or move the pushed tag. |
| Install, typecheck, test, or build fails | The workflow stops before publish and nothing is published | Fix the failure on the default branch, bump the version, refresh the lockfile only if the bump changes it, then push a new matching version tag |
| npm OIDC or registry failure | The version stays unpublished and the error appears in the workflow log | Before rerunning, query the exact version on the public registry with `npm view json-render-astryx@${VERSION} version --registry=https://registry.npmjs.org/`. If it returns the version, the publish already succeeded; do not rerun. If it returns `E404`, fix the trusted-publisher or registry configuration and rerun the same unchanged tag's workflow. Never delete or move the tag. |
| Version already published | npm rejects the duplicate `npm publish` | Bump to a new version, refresh the lockfile only if the bump changes it, merge, and push a new matching version tag |
