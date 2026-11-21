#!/usr/bin/env bash
# The pin-bump fix: it may only rewrite a digest the drift pass resolved, and only where the
# checkout actually pins it.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
FIX="${REPO_ROOT}/scripts/__image_scan_fix.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0 fail=0
ok() { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }

OLD="sha256:1111111111111111111111111111111111111111111111111111111111111111"
NEW="sha256:2222222222222222222222222222222222222222222222222222222222222222"
OTHER="sha256:3333333333333333333333333333333333333333333333333333333333333333"

fixture() {
  rm -rf "$WORK/repo" "$WORK/out"
  mkdir -p "$WORK/repo" "$WORK/out"
  cat > "$WORK/repo/docker-compose.yml" <<YAML
services:
  db:
    image: postgres:15@${OLD}
  cache:
    image: redis:7-alpine@${OTHER}
YAML
  cat > "$WORK/repo/docker-compose.security.yml" <<YAML
services:
  vault:
    image: hashicorp/vault:1.15@${OLD}
YAML
}

run() { IMAGE_SCAN_REPO="$WORK/repo" "$FIX" "$1" --out "$WORK/out" 2>&1; }

printf '\nno drift table means no rewrite\n'
fixture
out="$(run plan)"; rc=$?
[[ $rc -eq 2 ]] && ok "refuses to plan without a drift table (2)" || no "exit was $rc, expected 2"
grep -q 'no drift table' <<< "$out" && ok "says what to run first" || no "the refusal is silent"

printf '\na drifted pin is reported, not applied, by plan\n'
fixture
printf '%s\t%s\t%s\tdrift\ttag now serves x\n' "postgres:15@${OLD}" "$OLD" "$NEW" > "$WORK/out/drift.tsv"
out="$(run plan)"; rc=$?
[[ $rc -eq 1 ]] && ok "plan exits 1 when there is work (1)" || no "plan exit was $rc"
grep -q "$NEW" <<< "$out" && ok "plan names the digest it would use" || no "plan hides the target digest"
grep -q "$OLD" "$WORK/repo/docker-compose.yml" && ok "plan changed nothing on disk" || no "plan rewrote the file"

printf '\napply rewrites the pin in every file that carries it\n'
out="$(run apply)"; rc=$?
[[ $rc -eq 1 ]] && ok "apply exits 1 when it changed something (1)" || no "apply exit was $rc"
grep -q "@${NEW}" "$WORK/repo/docker-compose.yml" && ok "compose pin rewritten" || no "compose pin untouched"
grep -q "@${NEW}" "$WORK/repo/docker-compose.security.yml" && ok "second file rewritten too" || no "second file missed"
grep -q "@${OTHER}" "$WORK/repo/docker-compose.yml" && ok "an unrelated pin is untouched" || no "clobbered an unrelated pin"
[[ -z "$(find "$WORK/repo" -name '*.bak' -print -quit)" ]] && ok "no .bak left behind" || no "sed backup left on disk"

printf '\nunknown and ok rows are not evidence, so nothing is bumped\n'
fixture
{
  printf '%s\t%s\t%s\tunknown\tregistry rate limited\n' "postgres:15@${OLD}" "$OLD" "-"
  printf '%s\t%s\t%s\tok\t%s\t-\n' "redis:7-alpine@${OTHER}" "$OTHER" "$OTHER"
} > "$WORK/out/drift.tsv"
out="$(run apply)"; rc=$?
[[ $rc -eq 0 ]] && ok "no drift, no change, exit 0" || no "exit was $rc with no drift rows"
grep -q "@${OLD}" "$WORK/repo/docker-compose.yml" && ok "a rate-limited read never moves a pin" || no "bumped on an unanswered read"

printf '\na drift row the checkout does not pin is reported and skipped\n'
fixture
printf '%s\t%s\t%s\tdrift\tmoved\n' "grafana:11.2.2@sha256:9999999999999999999999999999999999999999999999999999999999999999" \
  "sha256:9999999999999999999999999999999999999999999999999999999999999999" "$NEW" > "$WORK/out/drift.tsv"
out="$(run apply)"; rc=$?
[[ $rc -eq 0 ]] && ok "an unpinned ref is not a rewrite (0)" || no "exit was $rc"
grep -q 'no compose file pins' <<< "$out" && ok "says why it skipped" || no "skip is silent"

printf '\nPASS: %d  FAIL: %d\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
