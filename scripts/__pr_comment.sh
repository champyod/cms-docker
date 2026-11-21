#!/usr/bin/env bash
# pr-comment — one upserted comment per marker, so a re-run replaces its own numbers.
#
# WHY a script and not a github-script block per job: four gates need the same upsert, and four
# copies of "list, find the marker, update or create" is how they drift apart.
#
# Usage:
#   __pr_comment.sh --marker <slug> --body-file <path> [--title <line>]
# Needs: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_PATH (a pull_request payload).
set -euo pipefail

MARKER=""; BODY_FILE=""; TITLE=""
die() { printf 'pr-comment: %s\n' "$*" >&2; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --marker) MARKER="${2:-}"; shift 2 ;;
    --marker=*) MARKER="${1#*=}"; shift ;;
    --body-file) BODY_FILE="${2:-}"; shift 2 ;;
    --body-file=*) BODY_FILE="${1#*=}"; shift ;;
    --title) TITLE="${2:-}"; shift 2 ;;
    --title=*) TITLE="${1#*=}"; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$MARKER" ]] || die "--marker is required"
[[ -n "$BODY_FILE" ]] || die "--body-file is required"
[[ -f "$BODY_FILE" ]] || die "no body at ${BODY_FILE}"
[[ -n "${GH_TOKEN:-}" ]] || die "GH_TOKEN is not set"
[[ -n "${GITHUB_REPOSITORY:-}" ]] || die "GITHUB_REPOSITORY is not set"

pr=''
if [[ -n "${GITHUB_EVENT_PATH:-}" && -f "${GITHUB_EVENT_PATH:-}" ]]; then
  pr="$(jq -r '.pull_request.number // empty' "$GITHUB_EVENT_PATH" 2>/dev/null || true)"
fi
if [[ -z "$pr" ]]; then
  # Not a PR event: say so and succeed, because a push build has nothing to comment on.
  printf 'pr-comment: not a pull request event; nothing to post\n'
  exit 0
fi

tag="<!-- ${MARKER} -->"
# A comment over Discord-free limits is rejected outright, so cut with a pointer rather than fail.
body="$(
  {
    printf '%s\n' "$tag"
    [[ -n "$TITLE" ]] && printf '### %s\n\n' "$TITLE"
    printf '```\n'
    head -c 55000 "$BODY_FILE"
    [[ "$(wc -c < "$BODY_FILE")" -gt 55000 ]] && printf '\n… (trimmed; see the job log for the rest)'
    printf '\n```\n'
  }
)"

existing="$(gh api "repos/${GITHUB_REPOSITORY}/issues/${pr}/comments" --paginate \
  --jq ".[] | select(.body | contains(\"${tag}\")) | .id" 2>/dev/null | head -1 || true)"

if [[ -n "$existing" ]]; then
  gh api --method PATCH "repos/${GITHUB_REPOSITORY}/issues/comments/${existing}" -f body="$body" >/dev/null
  printf 'pr-comment: updated #%s on PR %s\n' "$existing" "$pr"
else
  gh api --method POST "repos/${GITHUB_REPOSITORY}/issues/${pr}/comments" -f body="$body" >/dev/null
  printf 'pr-comment: posted on PR %s\n' "$pr"
fi
