#!/usr/bin/env bash
# tests/test_ci_filter_outputs.sh — a job may only gate on a filter the changes job publishes.
#
# WHY this exists: `dorny/paths-filter` writes its answers into the step, and the `changes` job has
# to republish each one as a job output before another job's `if:` can read it. Adding a filter
# block without the matching output line is silently inert: `needs.changes.outputs.security_scan`
# resolves to an empty string, the job's condition is false, and CI reports "skipped" — green, with
# the image never built. That is how the security scanner image came to be missing from a deploy
# while every run looked healthy.
#
# The check is a pure text comparison of the two lists in ci.yml:
#   * every `needs.changes.outputs.<name>` the file references, against
#   * every `<name>:` under the changes job's `outputs:` map.

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
CI="${REPO_ROOT}/.github/workflows/ci.yml"

pass=0
fail=0
ok()  { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no()  { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }

if [[ ! -f "$CI" ]]; then
  printf '  FAIL ci.yml is missing — nothing to check\n'
  printf '\nPASS: 0  FAIL: 1\n'
  exit 1
fi

# Referenced names, in the order they appear, deduplicated.
referenced="$(
  grep -oE 'needs\.changes\.outputs\.[A-Za-z0-9_]+' "$CI" \
    | sed 's/.*outputs\.//' | sort -u
)"

# Published names: the `outputs:` block of the `changes` job, which ends at its `steps:`.
published="$(
  awk '
    /^  changes:[[:space:]]*$/ { injob = 1; next }
    injob && /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ { injob = 0 }
    injob && /^    outputs:[[:space:]]*$/ { inout = 1; next }
    inout && /^    [a-zA-Z]/ && !/^    [a-z_]+: \$\{\{/ { inout = 0 }
    inout && /^      [A-Za-z0-9_]+:/ { sub(/^ +/, ""); sub(/:.*/, ""); print }
  ' "$CI" | sort -u
)"

if [[ -z "$referenced" ]]; then
  no "no needs.changes.outputs.* reference was found — the parse is broken, not the tree"
fi
if [[ -z "$published" ]]; then
  no "no output was found under the changes job — the parse is broken, not the tree"
fi

missing="$(comm -23 <(printf '%s\n' "$referenced") <(printf '%s\n' "$published") | sed '/^$/d')"
if [[ -z "$missing" ]]; then
  ok "every referenced filter is published by the changes job ($(printf '%s\n' "$referenced" | sed '/^$/d' | wc -l | tr -d ' ') names)"
else
  while read -r name; do
    [[ -n "$name" ]] || continue
    no "a job gates on needs.changes.outputs.${name}, but the changes job never publishes it — the job would be skipped, not run"
  done <<<"$missing"
fi

# The reverse direction is only a smell, not a failure: a published output nothing reads is
# harmless. It is reported so a reader can see the map is not stale.
unused="$(comm -13 <(printf '%s\n' "$referenced") <(printf '%s\n' "$published") | sed '/^$/d')"
if [[ -n "$unused" ]]; then
  ok "published but unread (harmless): $(printf '%s' "$unused" | tr '\n' ' ')"
fi

printf '\nPASS: %d  FAIL: %d\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
