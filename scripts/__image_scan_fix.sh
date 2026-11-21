#!/usr/bin/env bash
# image-scan fix — turn a drifted pin into a reviewable pull request, never into a silent bump.
#
# WHY it reads drift.tsv instead of asking the registries again: the drift pass already answered
# "what does this tag serve now", and a second implementation of that question is how a PR ends up
# proposing a digest the nightly scan never saw.
#
# WHY it refuses unknown and same: an unanswered registry read is not evidence, and a pin that
# already matches needs no change. Only `drift` rows with a resolved digest are rewritten.
#
# Usage:
#   __image_scan_fix.sh plan --out <dir>            # list the rewrites it would make; exit 1 if any
#   __image_scan_fix.sh apply --out <dir>           # rewrite the compose pins; exit 1 if it changed
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# IMAGE_SCAN_REPO exists so the test can point the rewrite at a fixture tree instead of the checkout.
REPO_ROOT="${IMAGE_SCAN_REPO:-$(cd -- "${SCRIPT_DIR}/.." && pwd)}"

COMMAND="${1:-}"
[[ $# -gt 0 ]] && shift
OUT_DIR=""
CHANGED=0

die() { printf 'image-scan fix: %s\n' "$*" >&2; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT_DIR="${2:-}"; shift 2 ;;
    --out=*) OUT_DIR="${1#*=}"; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ "$COMMAND" == "plan" || "$COMMAND" == "apply" ]] || die "usage: $0 plan|apply [--out <dir>]"
[[ -n "$OUT_DIR" ]] || OUT_DIR="${TMPDIR:-/tmp}/image-scan"
DRIFT="${OUT_DIR}/drift.tsv"
[[ -s "$DRIFT" ]] || die "no drift table at ${DRIFT} — run: __image_scan.sh drift"

# compose_pins <digest> — the files that pin this digest, one per line.
compose_pins() {
  grep -rl --include='docker-compose*.yml' -- "@$1" "$REPO_ROOT" 2>/dev/null | sort
}

printf 'digest drift, %s\n' "$COMMAND"
rows=0
while IFS=$'\t' read -r ref pinned current status reason; do
  [[ "$status" == "drift" ]] || continue
  [[ -n "$current" && "$current" == sha256:* ]] || continue
  # `|| true`: grep exits 1 when nothing pins this digest, and that is a case to report, not to die on.
  files="$(compose_pins "$pinned" || true)"
  if [[ -z "$files" ]]; then
    # A pinned ref the compose files no longer carry: report it, never invent a file to edit.
    printf '  skip %s — no compose file pins %s\n' "$ref" "${pinned:0:19}…"
    continue
  fi
  rows=$((rows + 1))
  printf '  bump %s\n' "${ref}"
  printf '       from %s\n       to   %s\n' "$pinned" "$current"
  while IFS= read -r file; do
    if [[ "$COMMAND" == "apply" ]]; then
      # -i.bak so a failed write leaves the original byte-identical, and the backup is removed after.
      sed -i.bak "s|@${pinned}|@${current}|g" "$file"
      rm -f "${file}.bak"
    fi
    printf '       in %s\n' "${file#"$REPO_ROOT"/}"
  done <<< "$files"
  CHANGED=1
done < "$DRIFT"

if [[ "$rows" -eq 0 ]]; then
  printf '  nothing to bump: every pinned digest is current or unreadable\n'
  exit 0
fi
printf '%d pin(s) %s\n' "$rows" "$([[ "$COMMAND" == "apply" ]] && echo rewritten || echo pending)"
exit 1
