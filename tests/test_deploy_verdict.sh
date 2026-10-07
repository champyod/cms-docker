#!/usr/bin/env bash
# tests/test_deploy_verdict.sh — pin the exit contract of deploy_verdict.
#
# WHY this suite exists: cmd_deploy reduces a whole deploy pass to three counts and hands
# them to deploy_verdict, so that one function alone decides whether the pass is reported
# as a success. Two of its answers used to be wrong, and nothing exercised either one, so
# both survived:
#   * a healthy split — this host deployed its local shards while remote registry-only
#     shards were skipped by design — returned 1, so a correct pass aborted as a failure;
#   * a pass that matched no shard at all returned 0, so a mis-registered fleet
#     (WORKER_n host vs hostname -I, WORKER_SHARDn_LOCAL) reported success having
#     deployed nothing at all.
# Skipping a remote shard is not an error, so only a failure or a pass that deployed
# nothing may fail. The table below is that contract, one row per shape.
#
# The function is lifted out of scripts/__worker_tui.sh and driven with counts, so no
# docker daemon, no network and no fleet file is involved. Set CMS_WORKER_TUI_REF=<ref>
# to lift it from a git ref instead of the working tree — that is how the suite is shown
# to guard the two holes above rather than merely pass today.
#
# Usage: bash tests/test_deploy_verdict.sh
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
TARGET="scripts/__worker_tui.sh"
FUNCTION="deploy_verdict"

# The suite collects failures instead of aborting on the first one, so it must undo the
# strict mode common.sh installs for its consumers. The path is resolved at runtime from
# the repository root, so shellcheck cannot follow it.
# shellcheck source=/dev/null
source "${ROOT}/scripts/__lib/common.sh"
set +eu +o pipefail
set -u

WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

FUNC_FILE="${WORK}/${FUNCTION}.fn"
ERR_FILE="${WORK}/stderr"

PASS=0
FAIL=0

ok()  { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"; }

check_eq() { # label expected actual
  if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected [${2}] got [${3}])"; fi
}

# Stage the script under test, then lift its one function out of the staged copy so that
# sourcing it cannot execute the TUI. Without a ref the working tree is the subject.
load_target() { # [ref]
  local ref="${1:-}" staged="${WORK}/target.sh"
  if [ -n "$ref" ]; then
    if ! git -C "$ROOT" show "${ref}:${TARGET}" >"$staged" 2>"${WORK}/git.err"; then
      bad "cannot read ${ref}:${TARGET} from git"
      sed 's/^/        /' "${WORK}/git.err"
      return 1
    fi
    printf 'target: %s at ref %s\n' "$TARGET" "$ref"
  else
    if [ ! -f "${ROOT}/${TARGET}" ]; then
      bad "${TARGET} is missing from the working tree"
      return 1
    fi
    cp -- "${ROOT}/${TARGET}" "$staged"
    printf 'target: %s (working tree)\n' "$TARGET"
  fi
  # A function body ends at the first column-zero brace; deploy_verdict nests no braces,
  # so the first `}` after the header closes it.
  awk -v name="$FUNCTION" '
    $0 ~ "^" name "\\(\\)[[:space:]]*\\{" { inside = 1 }
    inside { print }
    inside && /^}/ { exit }
  ' "$staged" >"$FUNC_FILE"
  if [ ! -s "$FUNC_FILE" ]; then
    bad "${FUNCTION} was not found in ${TARGET}"
    return 1
  fi
  # shellcheck source=/dev/null
  source "$FUNC_FILE"
}

# One pass, in a subshell so the verdict's own status is the status we measure and no case
# can leak state into the next. Warnings go to ERR_FILE because log_warn writes to stderr.
run_verdict() { # deployed skipped failed
  ( set +e; deploy_verdict "$1" "$2" "$3" ) 2>"$ERR_FILE"
}

# The verdict must say WHY it failed, and the two warnings mean opposite things: "no
# shards matched" is a mis-registered fleet, "deploy incomplete" is a healthy partial
# deploy. Pinning which of the two fires is what keeps a fix from silencing the wrong one.
warning_matches() { # expected warning shape
  local want="$1" out="$2" no_match=no incomplete=no
  [[ "$out" == *'no shards matched this host'* ]] && no_match=yes
  [[ "$out" == *'deploy incomplete'* ]] && incomplete=yes
  case "$want" in
    none)       [ "$no_match" = no ] && [ "$incomplete" = no ] ;;
    incomplete) [ "$incomplete" = yes ] && [ "$no_match" = no ] ;;
    nomatch)    [ "$no_match" = yes ] && [ "$incomplete" = no ] ;;
    *) return 1 ;;
  esac
}

# Every distinct count triple the pass can end on. The two warnings are alternative
# explanations, not a list: the first branch that matches returns, so exactly one of
# them is ever emitted and an all-remote pass is explained by "no shards matched"
# rather than by the skipped-row count.
#
# label | deployed | skipped | failed | expected exit | expected warning
CASES=(
  "every local shard deployed|3|0|0|0|none"
  "single local shard|1|0|0|0|none"
  "healthy split: local deployed, remote skipped|2|1|0|0|incomplete"
  "healthy split at fleet scale|5|2|0|0|incomplete"
  "no shard matched, or an empty fleet|0|0|0|1|nomatch"
  "single remote shard, nothing deployed|0|1|0|1|nomatch"
  "every shard remote-only|0|2|0|1|nomatch"
  "failure only, nothing deployed|0|0|1|1|none"
  "deployed with one failure|2|0|1|1|none"
  "deployed, skipped and failed|1|1|1|1|incomplete"
  "wide pass, skipped and failed together|3|1|1|1|incomplete"
)

printf '== loading %s ==\n' "$FUNCTION"
if ! load_target "${CMS_WORKER_TUI_REF:-}"; then
  printf '\n== summary ==\nPASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
  exit 1
fi

printf '\n== deploy_verdict exit contract ==\n'
for record in "${CASES[@]}"; do
  IFS='|' read -r label deployed skipped failed want_rc want_warn <<< "$record"
  got_rc=0
  run_verdict "$deployed" "$skipped" "$failed" || got_rc=$?
  printf '\n-- %s (deployed=%s skipped=%s failed=%s)\n' \
    "$label" "$deployed" "$skipped" "$failed"
  check_eq "exit code is ${want_rc}" "$want_rc" "$got_rc"
  if warning_matches "$want_warn" "$(cat "$ERR_FILE")"; then
    ok "warning set is [${want_warn}]"
  else
    bad "warning set is [${want_warn}] (got [$(tr '\n' ';' <"$ERR_FILE")])"
  fi
done

# The incomplete warning must count the whole pass, not only the skipped rows, or an
# operator cannot tell a full-fleet deploy from a partial one.
run_verdict 5 2 0 || true
check_eq "the incomplete warning counts deployed+skipped+failed" "yes" \
  "$(grep -q '2 of 7 shard' "$ERR_FILE" && echo yes || echo no)"

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]] || exit 1
printf 'ALL PASS\n'
