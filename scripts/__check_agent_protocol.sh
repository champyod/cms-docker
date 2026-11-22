#!/bin/sh
# Asserts that every verbatim copy of the agent protocol matches §1 of dev/agent-protocol.md.
#
# WHY: a rule that exists twice in different words is two rules, and the reader cannot tell which
# one binds. The copy is therefore mechanical and this gate is what keeps it mechanical.
#
# Usage: scripts/__check_agent_protocol.sh [additional-copy ...]
set -u

canonical=dev/agent-protocol.md
copies="AGENTS.md"
[ $# -gt 0 ] && copies="$copies $*"

[ -f "$canonical" ] || { echo "FAIL: $canonical is missing" >&2; exit 1; }

extract() { # file -> the marked block, or nothing
  awk '/^<!-- BEGIN agent-protocol/{on=1} on{print} /^<!-- END agent-protocol/{on=0}' "$1"
}

canon=$(mktemp) || exit 1
copy=$(mktemp) || exit 1
trap 'rm -f "$canon" "$copy"' EXIT INT TERM

extract "$canonical" > "$canon"
n=$(wc -l < "$canon")
[ "$n" -gt 10 ] || { echo "FAIL: no protocol block in $canonical" >&2; exit 1; }

# The block must carry every operative rule, so a truncated copy cannot pass by being empty.
for needle in "Tier A" "Tier B" "Tier C" "Selection" "Context" "Evidence" "Never"; do
  grep -q "$needle" "$canon" || {
    echo "FAIL: $canonical §1 lost its '$needle' rule" >&2; exit 1; }
done

rc=0
for f in $copies; do
  if [ ! -f "$f" ]; then
    echo "FAIL: copy $f is missing" >&2; rc=1; continue
  fi
  extract "$f" > "$copy"
  if [ "$(wc -l < "$copy")" -le 10 ]; then
    echo "FAIL: $f carries no protocol block" >&2; rc=1; continue
  fi
  if ! cmp -s "$canon" "$copy"; then
    echo "FAIL: $f has drifted from $canonical §1" >&2
    diff -u "$canon" "$copy" | head -20 >&2
    rc=1
  fi
done

[ "$rc" -eq 0 ] && echo "agent-protocol: $copies match $canonical §1 ($n lines)"
exit "$rc"
