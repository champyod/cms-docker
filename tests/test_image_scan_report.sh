#!/usr/bin/env bash
# The nightly summary leads with a verdict, because a reader asks "do I have to do anything"
# before reading a table. These cases pin the three tiers plus the two failure modes.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCAN="${REPO_ROOT}/scripts/__image_scan.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0 fail=0
ok() { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }

# fixture <fixable> <drifted> <unknown> [no-table]
fixture() {
  rm -rf "$WORK/out"; mkdir -p "$WORK/out"
  [[ "${4:-}" == "no-table" ]] || {
    printf 'postgres:15@sha256:aaa\t88\topenssl\nnginx:alpine@sha256:bbb\t4\tzlib\n' > "$WORK/out/total.tsv"
    printf 'postgres:15@sha256:aaa\t26\n' > "$WORK/out/fixable.tsv"
    printf '%s\n' "$1" > "$WORK/out/fixable-total"
  }
  : > "$WORK/out/drift.tsv"
  local i=0
  while [[ $i -lt $2 ]]; do
    printf 'redis:7-alpine@sha256:c%s\tsha256:c%s\tsha256:d%s\tdrift\tmoved\n' "$i" "$i" "$i" >> "$WORK/out/drift.tsv"
    i=$((i + 1))
  done
  i=0
  while [[ $i -lt $3 ]]; do
    printf 'vault:1.15@sha256:e%s\tsha256:e%s\t-\tunknown\trate limited\n' "$i" "$i" >> "$WORK/out/drift.tsv"
    i=$((i + 1))
  done
  printf 'findings\n' > "$WORK/out/state"
}

summary() { bash "$SCAN" report --out "$WORK/out" 2>/dev/null; }

printf '\nfixable findings are an act-now verdict with the action named\n'
fixture 26 0 0
out="$(summary)"
grep -q 'Verdict: act now' <<< "$out" && ok "a fixable finding reads act now" || no "no act-now verdict"
grep -q '26 fixable CRITICAL/HIGH' <<< "$out" && ok "the count is in the verdict line" || no "count missing"
grep -q 'merge `fix/image-digests`' <<< "$out" && ok "the action names the PR the run proposes" || no "action not named"

printf '\ndrift alone is also act now\n'
fixture 0 3 0
out="$(summary)"
grep -q 'Verdict: act now' <<< "$out" && ok "drift without fixable findings still acts" || no "drift was not actionable"
grep -q '3 drifted' <<< "$out" && ok "drift count is in the verdict" || no "drift count missing"

printf '\nan unreadable registry is not an all-clear\n'
fixture 0 0 2
out="$(summary)"
grep -q 'Verdict: not fully judged' <<< "$out" && ok "unknown reads as not fully judged" || no "unknown read as clean"
grep -q 'a rate limit is not an all-clear' <<< "$out" && ok "says why it cannot clear" || no "no explanation"

printf '\nall current earns the quiet verdict, with no action line\n'
fixture 0 0 0
out="$(summary)"
grep -q 'Verdict: nothing to do' <<< "$out" && ok "a clean night says nothing to do" || no "clean night has no verdict"
grep -q 'What to do:' <<< "$out" && no "a clean night still asked for action" || ok "no action asked when there is none"

printf '\nno table means no verdict, never a clean one\n'
fixture 0 0 0 no-table
out="$(summary)"
grep -q 'Verdict: could not judge' <<< "$out" && ok "a missing table reads could not judge" || no "a missing table read as a verdict"
grep -q 'Verdict: nothing to do' <<< "$out" && no "a missing table read as clean" || ok "a missing table is not clean"

printf '\nPASS: %d  FAIL: %d\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
