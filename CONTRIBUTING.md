# Contributing to json-render-astryx

This guide covers local validation, npm trusted publisher setup, and the
tag-driven release procedure for later versions.

## Prerequisites

| Tool | Version |
| --- | --- |
| Node.js | 22.18.0 |
| npm | 11.5.1 |
| pnpm | 10.23.0 |
| Just | 1.43.1 or newer |
| GitHub CLI (`gh`) | authenticated to `github.com` |

Just runs the documented recipes. `preflight` additionally uses an authenticated
`gh` API request to verify the registered publish workflow name, path, and active
state.

## Local validation

Run `just` to list every available recipe, or `just version` to print the
current package version.

<details>
<summary>Equivalent raw version command</summary>

```bash
node -p "require('./packages/json-render-astryx/package.json').version"
```

</details>

Run commands from any directory inside the repository. Just resolves every
recipe from the repository root.

Install the pinned dependencies when setting up or refreshing the checkout:

```bash
just install
```

Run the complete local gate before opening a pull request:

```bash
just check
```

`just check` runs typecheck, tests, build, and the npm package dry run. The dry
run lists the tarball contents. Expect `README.md`, `package.json`, and the built
`dist/` outputs, with no `src`, workspace files, or generated `.tgz`.

<details>
<summary>Equivalent raw commands</summary>

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm --filter json-render-astryx exec npm pack --dry-run --json
```

</details>

## Default-branch preflight

Run this preflight before every release tag:

```bash
just preflight
```

`just preflight`:

- rejects a dirty index or worktree;
- resolves the real default branch from `origin`'s symbolic `HEAD`;
- rejects a detached checkout or any branch other than the default;
- fetches the default branch and requires exact local/remote `HEAD` equality;
- verifies through the authenticated `gh` API that the registered workflow is
  named `Publish json-render-astryx`, uses `.github/workflows/publish.yml`, and
  has state `active`;
- validates the manifest version as SemVer; and
- rejects an existing matching local or remote tag.

<details>
<summary>Equivalent raw commands</summary>

```bash
set -euo pipefail

test -z "$(git status --porcelain=v1 --untracked-files=normal)"

WORKFLOW=".github/workflows/publish.yml"
test -f "$WORKFLOW"
command -v gh >/dev/null 2>&1
WORKFLOW_INFO="$(gh api repos/{owner}/{repo}/actions/workflows/publish.yml --jq '[.name, .path, .state] | @tsv')"
IFS=$'\t' read -r WORKFLOW_NAME WORKFLOW_PATH WORKFLOW_STATE <<< "$WORKFLOW_INFO"
test "$WORKFLOW_NAME" = "Publish json-render-astryx"
test "$WORKFLOW_PATH" = ".github/workflows/publish.yml"
test "$WORKFLOW_STATE" = active

git remote get-url origin >/dev/null
PUSH_URL="$(git remote get-url --push --all origin)"
test "$(printf '%s\n' "$PUSH_URL" | grep -c .)" -eq 1
DEFAULT_REF="$(
  git ls-remote --symref origin HEAD \
    | awk '$1 == "ref:" && $3 == "HEAD" { print $2; exit }'
)"
case "$DEFAULT_REF" in
  refs/heads/*) ;;
  *) printf 'origin HEAD did not resolve to refs/heads/*\n' >&2; exit 1 ;;
esac
DEFAULT_BRANCH="${DEFAULT_REF#refs/heads/}"
CURRENT_BRANCH="$(git symbolic-ref --quiet --short HEAD)"
test "$CURRENT_BRANCH" = "$DEFAULT_BRANCH"

git fetch --quiet origin \
  "+${DEFAULT_REF}:refs/remotes/origin/${DEFAULT_BRANCH}"
LOCAL_HEAD="$(git rev-parse --verify HEAD)"
REMOTE_HEAD="$(git rev-parse --verify "refs/remotes/origin/${DEFAULT_BRANCH}")"
test "$LOCAL_HEAD" = "$REMOTE_HEAD"

VERSION="$(node -p "require('./packages/json-render-astryx/package.json').version")"
node -e '
  const version = process.argv[1];
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
  process.exit(semver.test(version) ? 0 : 1);
' "$VERSION"
TAG="v${VERSION}"
if git show-ref --verify --quiet "refs/tags/${TAG}"; then
  printf 'local tag %s already exists\n' "$TAG" >&2
  exit 1
fi
if git ls-remote --exit-code --tags "$PUSH_URL" "refs/tags/${TAG}" >/dev/null 2>&1; then
  printf 'remote tag %s already exists\n' "$TAG" >&2
  exit 1
else
  test "$?" -eq 2
fi
```

</details>

Preflight gates release tagging so no tag ever inherits an arbitrary or stale
`HEAD`. Resolve any failure before continuing; never bypass a failing gate.

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

After the trusted publisher exists and the workflow is active, each release is
a pushed version tag. The workflow in `.github/workflows/publish.yml` checks out
the tag, verifies it equals `v` plus the manifest version, runs the workspace
gates, and publishes without a token.

1. Prepare the version bump:

   ```bash
   just bump patch
   # or: just bump minor
   # or: just bump major
   ```

   `just bump` accepts only `patch`, `minor`, or `major`. It runs
   `npm version --no-git-tag-version` against
   `packages/json-render-astryx/package.json` so the version change lands through
   a reviewed pull request instead of a local tag, then refreshes the lockfile
   with `pnpm install --lockfile-only`. The `packages/json-render-astryx`
   importer in `pnpm-lock.yaml` records dependency specifiers but not the
   package's own version, so a version-only bump normally leaves the lockfile
   untouched; include a lockfile change only when the bump actually produces one.

   <details>
   <summary>Equivalent raw commands</summary>

   ```bash
   (
     cd packages/json-render-astryx
     npm version patch --no-git-tag-version
     # or: npm version minor --no-git-tag-version
     # or: npm version major --no-git-tag-version
   )
   pnpm install --lockfile-only
   ```

   </details>

2. Validate locally:

   ```bash
   just check
   ```

   <details>
   <summary>Equivalent raw commands</summary>

   ```bash
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm --filter json-render-astryx exec npm pack --dry-run --json
   ```

   </details>

3. Open a pull request with the manifest version change and any lockfile
   update the bump produced, then merge it to the default branch.

4. After review and merge, run the immutable release actions in order:

   ```bash
   just preflight
   just tag
   just push-tag confirm=PUSH
   ```

   - `just tag` creates an annotated local `v<manifest-version>` tag only after
     `preflight` passes.
   - `just push-tag` requires the exact literal `confirm=PUSH` argument.
   - `just push-tag` requires an annotated matching local tag pointing to `HEAD`.
   - `just push-tag` refuses an existing remote tag and never force-pushes.
   - Bumping, tagging, and pushing remain separate commands; they are never
     chained into one release step.

   <details>
   <summary>Equivalent raw commands</summary>

   ```bash
  set -euo pipefail

   VERSION="$(node -p "require('./packages/json-render-astryx/package.json').version")"
   TAG="v${VERSION}"
   git tag -a "$TAG" -m "json-render-astryx ${TAG}"

   CONFIRM="PUSH"
   test "$CONFIRM" = "PUSH"
   test "$(git cat-file -t "refs/tags/${TAG}")" = "tag"
   test "$(git rev-parse "${TAG}^{commit}")" = "$(git rev-parse HEAD)"

   PUSH_URL="$(git remote get-url --push --all origin)"
   test "$(printf '%s\n' "$PUSH_URL" | grep -c .)" -eq 1
   if git ls-remote --exit-code --tags "$PUSH_URL" "refs/tags/${TAG}" >/dev/null 2>&1; then
     printf 'remote tag %s already exists\n' "$TAG" >&2
     exit 1
   else
     test "$?" -eq 2
   fi
   git push --no-follow-tags "$PUSH_URL" "refs/tags/${TAG}:refs/tags/${TAG}"
   ```

   </details>

5. Push one release tag at a time. The workflow has no concurrency group,
   because GitHub keeps at most one pending run per group and would silently
   drop an older pending tagged release. Pushing tags one at a time gives every
   immutable version its own publish attempt.

6. Verify the release against the public registry before starting another tag:

   ```bash
   just verify-published
   ```

   <details>
   <summary>Equivalent raw commands</summary>

   ```bash
  VERSION="$(node -p "require('./packages/json-render-astryx/package.json').version")"
   NPM_REGISTRY="https://registry.npmjs.org/"
   test "$(npm view json-render-astryx@${VERSION} version --registry="${NPM_REGISTRY}")" = "${VERSION}"
   ```

   </details>

   - The Actions run for the tag must finish green.
   - The command above must print no error and confirm the exact version on the
     public registry.

   Wait for both the green Actions run and this exact-version match on the public
   registry before pushing the next release tag.

## Immutable versions and recovery

Every published npm version is permanent; it cannot be overwritten or reused.

| Situation | What happens | Recovery |
| --- | --- | --- |
| Tag pushed while the publish workflow is inactive or not recognized by GitHub Actions | No Actions run starts and nothing is published; the pushed tag is inert | Leave the inert tag in place; pushed tags are immutable. Activate or repair the workflow in a reviewed change and confirm GitHub Actions lists `Publish json-render-astryx`, bump to a new version, merge, then push a new matching version tag. Never delete or move the inert tag. |
| Tag does not match the manifest version | The verify step fails before install, tests, or publish | Leave the pushed tag in place; pushed tags are immutable. Correct the manifest version on the default branch through a reviewed change, then push a new matching version tag. Never delete or move the pushed tag. |
| Install, typecheck, test, or build fails | The workflow stops before publish and nothing is published | Fix the failure on the default branch, bump the version, refresh the lockfile only if the bump changes it, then push a new matching version tag |
| npm OIDC or registry failure | The version stays unpublished and the error appears in the workflow log | Before rerunning, query the exact version on the public registry with `npm view json-render-astryx@${VERSION} version --registry=https://registry.npmjs.org/`. If it returns the version, the publish already succeeded; do not rerun. If it returns `E404`, fix the trusted-publisher or registry configuration and rerun the same unchanged tag's workflow. Never delete or move the tag. |
| Version already published | npm rejects the duplicate `npm publish` | Bump to a new version, refresh the lockfile only if the bump changes it, merge, and push a new matching version tag |
