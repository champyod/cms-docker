#!/usr/bin/env bash
# The upsert contract: one comment per marker, replaced on a re-run, and never posted off a PR.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${REPO_ROOT}/scripts/__pr_comment.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0 fail=0
ok() { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }

# A gh shim: records every call, and answers the list call with $EXISTING_IDS.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/gh" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$GH_CALLS"
if [[ "$1" == "api" && "$2" == repos/*/issues/*/comments && "${4:-}" != "" ]]; then
  printf '%s\n' "${EXISTING_IDS:-}"
fi
exit 0
SH
chmod +x "$WORK/bin/gh"

export PATH="$WORK/bin:$PATH" GH_CALLS="$WORK/calls" GH_TOKEN=tok GITHUB_REPOSITORY=owner/repo
export EXISTING_IDS=""
payload() { printf '{"pull_request":{"number":%s}}' "$1" > "$WORK/event.json"; export GITHUB_EVENT_PATH="$WORK/event.json"; }
printf 'waiver 12 expired on 2026-11-01\n' > "$WORK/body.txt"

run() { bash "$SCRIPT" --marker cms-waiver-gate --body-file "$WORK/body.txt" --title "Waiver gate" 2>&1; }

printf '\na new finding is posted once\n'
payload 7; : > "$WORK/calls"; export EXISTING_IDS=""
out="$(run)"; rc=$?
[[ $rc -eq 0 ]] && ok "posts successfully" || no "exit was $rc"
grep -q 'issues/7/comments' "$WORK/calls" && ok "posts to the pull request's comments" || no "posted nowhere"
grep -q 'POST' "$WORK/calls" && ok "uses POST for a new comment" || no "no POST"
grep -q 'pr-comment: posted on PR 7' <<< "$out" && ok "reports what it did" || no "silent"

printf '\na re-run replaces its own comment instead of stacking\n'
payload 7; : > "$WORK/calls"; export EXISTING_IDS="4242"
out="$(run)"; rc=$?
[[ $rc -eq 0 ]] && ok "exits 0 on update" || no "exit was $rc"
grep -q 'issues/comments/4242' "$WORK/calls" && ok "patches the existing comment" || no "did not target the existing comment"
grep -q 'PATCH' "$WORK/calls" && ok "uses PATCH" || no "used POST for an update"
grep -q 'pr-comment: updated #4242' <<< "$out" && ok "names the comment it updated" || no "silent update"

printf '\na marker is embedded, so one gate cannot overwrite another\n'
payload 7; : > "$WORK/calls"; export EXISTING_IDS=""
run >/dev/null
grep -q 'cms-waiver-gate' "$WORK/calls" && ok "the marker travels with the comment" || no "no marker in the request"

printf '\noff a pull request it stays quiet and succeeds\n'
printf '{"ref":"refs/heads/main"}' > "$WORK/event.json"; export GITHUB_EVENT_PATH="$WORK/event.json"
: > "$WORK/calls"
out="$(run)"; rc=$?
[[ $rc -eq 0 ]] && ok "a push build exits 0" || no "exit was $rc off a PR"
[[ -s "$WORK/calls" ]] && no "posted a comment on a push build" || ok "posted nothing off a PR"
grep -q 'not a pull request event' <<< "$out" && ok "says why it stayed quiet" || no "silent skip"

printf '\na missing token is an error, not a silent skip\n'
payload 7; unset GH_TOKEN
out="$(run)"; rc=$?
[[ $rc -eq 2 ]] && ok "refuses without a token (2)" || no "exit was $rc"
grep -q 'GH_TOKEN' <<< "$out" && ok "names what is missing" || no "unclear refusal"
export GH_TOKEN=tok

printf '\nPASS: %d  FAIL: %d\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
