set working-directory := '.'
set positional-arguments := true

default:
    @just --list

install:
    pnpm install --frozen-lockfile

check:
    pnpm typecheck
    pnpm test
    pnpm build
    pnpm --filter json-render-astryx exec npm pack --dry-run --json

version:
    @node -p "require('./packages/json-render-astryx/package.json').version"

bump kind:
    #!/usr/bin/env bash
    set -euo pipefail

    case "$1" in
      patch|minor|major)
        ;;
      *)
        printf 'bump: kind must be patch, minor, or major; received %q\n' "$1" >&2
        exit 2
        ;;
    esac

    (
      cd packages/json-render-astryx
      npm version "$1" --no-git-tag-version
    )
    pnpm install --lockfile-only

preflight:
    #!/usr/bin/env bash
    set -euo pipefail

    fail() {
      printf 'preflight: %s\n' "$*" >&2
      exit 1
    }

    if [[ -n "$(git status --porcelain=v1 --untracked-files=normal)" ]]; then
      fail "working tree or index is not clean"
    fi

    command -v gh >/dev/null 2>&1 \
      || fail "gh is required to verify the publish workflow state"

    workflow=".github/workflows/publish.yml"
    [[ -f "$workflow" ]] || fail "missing ${workflow}"
    workflow_info="$(gh api repos/{owner}/{repo}/actions/workflows/publish.yml \
      --jq '[.name, .path, .state] | @tsv' 2>/dev/null)" \
      || fail "could not query publish workflow via gh"
    IFS=$'\t' read -r workflow_name workflow_path workflow_state <<< "$workflow_info"
    [[ "$workflow_name" == "Publish json-render-astryx" ]] \
      || fail "unexpected publish workflow name ${workflow_name}"
    [[ "$workflow_path" == ".github/workflows/publish.yml" ]] \
      || fail "unexpected publish workflow path ${workflow_path}"
    [[ "$workflow_state" == "active" ]] \
      || fail "publish workflow state ${workflow_state} is not active"

    git remote get-url origin >/dev/null 2>&1 \
      || fail "origin remote is missing"

    push_urls="$(git remote get-url --push --all origin)" \
      || fail "could not resolve origin push URL"
    push_url=""
    push_url_count=0
    while IFS= read -r push_url_line; do
      [[ -n "$push_url_line" ]] || continue
      push_url_count=$((push_url_count + 1))
      push_url="$push_url_line"
    done <<< "$push_urls"
    [[ "$push_url_count" -eq 1 ]] \
      || fail "expected exactly one origin push URL, found ${push_url_count}"

    default_ref="$(
      git ls-remote --symref origin HEAD 2>/dev/null \
        | awk '$1 == "ref:" && $3 == "HEAD" { print $2; exit }'
    )" || fail "could not query origin HEAD"
    case "$default_ref" in
      refs/heads/*)
        ;;
      *)
        fail "origin HEAD did not resolve to refs/heads/*"
        ;;
    esac
    default_branch="${default_ref#refs/heads/}"

    current_branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" \
      || fail "HEAD is detached"
    [[ "$current_branch" == "$default_branch" ]] \
      || fail "current branch ${current_branch} is not origin default branch ${default_branch}"

    git fetch --quiet origin \
      "+${default_ref}:refs/remotes/origin/${default_branch}" \
      || fail "could not fetch origin/${default_branch}"

    local_head="$(git rev-parse --verify HEAD)" \
      || fail "could not resolve local HEAD"
    remote_head="$(git rev-parse --verify "refs/remotes/origin/${default_branch}")" \
      || fail "could not resolve origin/${default_branch}"
    [[ "$local_head" == "$remote_head" ]] \
      || fail "local HEAD ${local_head} does not equal origin/${default_branch} ${remote_head}"

    version="$(node -p "require('./packages/json-render-astryx/package.json').version")" \
      || fail "could not read package version"
    node -e '
      const version = process.argv[1];
      const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
      process.exit(semver.test(version) ? 0 : 1);
    ' "$version" || fail "package version ${version} is not valid SemVer"
    tag="v${version}"

    if git show-ref --verify --quiet "refs/tags/${tag}"; then
      fail "local tag ${tag} already exists"
    fi

    if git ls-remote --exit-code --tags "$push_url" "refs/tags/${tag}" >/dev/null 2>&1; then
      fail "remote tag ${tag} already exists"
    else
      remote_status=$?
      [[ "$remote_status" -eq 2 ]] \
        || fail "could not query remote tag ${tag}"
    fi

    printf 'preflight: default branch %s\n' "$default_branch"
    printf 'preflight: HEAD %s matches origin/%s\n' "$local_head" "$default_branch"
    printf 'preflight: workflow active; version %s; tag %s available\n' "$version" "$tag"

tag: preflight
    #!/usr/bin/env bash
    set -euo pipefail

    version="$(node -p "require('./packages/json-render-astryx/package.json').version")"
    tag="v${version}"
    git tag --annotate "$tag" --message "json-render-astryx ${tag}"
    printf 'tag: created annotated local tag %s\n' "$tag"

push-tag confirmation:
    #!/usr/bin/env bash
    set -euo pipefail

    fail() {
      printf 'push-tag: %s\n' "$*" >&2
      exit 1
    }

    [[ "$1" == "confirm=PUSH" ]] \
      || fail "refusing to push; run: just push-tag confirm=PUSH"

    version="$(node -p "require('./packages/json-render-astryx/package.json').version")" \
      || fail "could not read package version"
    tag="v${version}"

    git show-ref --verify --quiet "refs/tags/${tag}" \
      || fail "matching local tag ${tag} does not exist"
    object_type="$(git cat-file -t "refs/tags/${tag}" 2>/dev/null)" \
      || fail "could not inspect local tag ${tag}"
    [[ "$object_type" == "tag" ]] \
      || fail "local tag ${tag} is not annotated"

    tag_commit="$(git rev-parse --verify "${tag}^{commit}")" \
      || fail "local tag ${tag} does not resolve to a commit"
    head_commit="$(git rev-parse --verify HEAD)" \
      || fail "could not resolve local HEAD"
    [[ "$tag_commit" == "$head_commit" ]] \
      || fail "local tag ${tag} does not point to HEAD"

    push_urls="$(git remote get-url --push --all origin)" \
      || fail "could not resolve origin push URL"
    push_url=""
    push_url_count=0
    while IFS= read -r push_url_line; do
      [[ -n "$push_url_line" ]] || continue
      push_url_count=$((push_url_count + 1))
      push_url="$push_url_line"
    done <<< "$push_urls"
    [[ "$push_url_count" -eq 1 ]] \
      || fail "expected exactly one origin push URL, found ${push_url_count}"

    if git ls-remote --exit-code --tags "$push_url" "refs/tags/${tag}" >/dev/null 2>&1; then
      fail "remote tag ${tag} already exists; tags are immutable"
    else
      remote_status=$?
      [[ "$remote_status" -eq 2 ]] \
        || fail "could not query remote tag ${tag}"
    fi

    git push --no-follow-tags "$push_url" "refs/tags/${tag}:refs/tags/${tag}"
    printf 'push-tag: pushed %s without moving any existing tag\n' "$tag"

verify-published:
    #!/usr/bin/env bash
    set -euo pipefail

    version="$(node -p "require('./packages/json-render-astryx/package.json').version")"
    registry="https://registry.npmjs.org/"
    published="$(npm view "json-render-astryx@${version}" version --registry="$registry")"
    if [[ "$published" != "$version" ]]; then
      printf "verify-published: registry returned '%s'; expected '%s'\n" \
        "$published" "$version" >&2
      exit 1
    fi
    printf 'verify-published: json-render-astryx@%s is published\n' "$version"
