#!/usr/bin/env bash
# tests/test_image_scan_workflow.sh — the nightly pinned-image scan exists, and it is wired the
# way the design says (advisory, discovered, waived, one issue), not just "a yml file is present".
#
# WHY this suite exists: the failure mode of a scan is not a crash, it is a scan that quietly
# stops covering something. A hardcoded image list, a workflow that someone adds to the required
# `CI` aggregator, a waivers step that stops running, an issue-per-run that becomes noise, a drift
# check that reports `up to date` because it was rate-limited — each of those keeps the job green
# while the signal is gone. Every assertion below is one of those ways, read off the committed
# tree.
#
# Two halves:
#   1. the workflow file — triggers, permissions, absence from the merge gate, waiver render,
#      summary, issue upsert, drift wiring, SHA-pinned actions;
#   2. the inventory — `scripts/__image_scan.sh refs` is run and compared against an independent
#      parse of the compose files, so "it discovers what the repo ships" is proved rather than
#      promised. A hardcoded list cannot pass this: the moment compose changes, the two disagree.
#
# Hermetic: no network, no docker, no registry. The registry paths are exercised through a `curl`
# shim on PATH (200-match, 200-different, 429), because the one thing the drift check must never
# do is turn a check that could not run into "up to date".
#
# Usage: bash tests/test_image_scan_workflow.sh
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
WF="${REPO_ROOT}/.github/workflows/image-scan.yml"
CI="${REPO_ROOT}/.github/workflows/ci.yml"
SCAN="${REPO_ROOT}/scripts/__image_scan.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

printf '== the workflow file exists and is an advisory schedule ==\n'

if [ -f "$WF" ]; then
  ok ".github/workflows/image-scan.yml exists"
else
  no ".github/workflows/image-scan.yml is missing — nothing scans the pinned third-party images"
fi

if [ -f "$WF" ] && grep -qE '^on:' "$WF" && grep -qE '^  schedule:' "$WF"; then
  ok "it runs on a schedule"
else
  no "it has no schedule: trigger"
fi

# A cron that nobody can read in local time is a cron nobody sets on purpose. The comment must
# state the Bangkok hour, and the arithmetic must agree with it: cron is UTC, Bangkok is UTC+7.
cron="$(grep -E "^ +- cron: '" "$WF" 2>/dev/null | head -1 | sed -E "s/.*cron: '([^']+)'.*/\1/")"
if [ -n "$cron" ]; then
  ok "schedule cron present (${cron})"
  set -- $cron
  if [ "$#" -ge 2 ] && [[ "$1" =~ ^[0-9]+$ ]] && [[ "$2" =~ ^[0-9]+$ ]]; then
    minute="$1"; hour="$2"
    if [ $((10#$minute)) -lt 60 ] && [ $((10#$hour)) -lt 24 ]; then
      ok "cron minute/hour are valid fields"
    else
      no "cron minute/hour out of range: ${minute} ${hour}"
    fi
    local_hour=$(( (10#$hour + 7) % 24 ))
    stamp="$(printf '%02d:%02d' "$local_hour" "$((10#$minute))")"
    if grep -qF -- "${stamp}" "$WF" && grep -qF 'Asia/Bangkok' "$WF"; then
      ok "the cron is documented in Bangkok time (${stamp} Asia/Bangkok)"
    else
      no "the cron is not explained in Bangkok time — UTC ${hour}:${minute} is ${stamp} local, and the file does not say so"
    fi
  else
    no "cron is not a plain minute/hour schedule: ${cron}"
  fi
else
  no "no cron entry found under schedule:"
fi

if grep -qE '^  workflow_dispatch:' "$WF" 2>/dev/null; then
  ok "it can be run on demand (workflow_dispatch)"
else
  no "no workflow_dispatch trigger — a mid-day CVE has to wait for the window"
fi

printf '\n== least privilege, and NOT a merge gate ==\n'

if grep -qE '^  contents: read$' "$WF" 2>/dev/null && grep -qE '^  issues: write$' "$WF" 2>/dev/null; then
  ok "permissions are contents: read + issues: write"
else
  no "permissions are not exactly contents: read + issues: write"
fi

if [ "$(grep -vE '^[[:space:]]*#' "$WF" 2>/dev/null | grep -cE ': write')" = "1" ] &&
   ! grep -q 'write-all' "$WF" 2>/dev/null; then
  ok "no write scope beyond issues"
else
  no "an extra write scope (or write-all) is granted"
fi

if grep -qiE 'secrets\.|PERSONAL_ACCESS_TOKEN|\bPAT\b' "$WF" 2>/dev/null; then
  no "the workflow reads a secret — the default GITHUB_TOKEN is the whole credential budget"
else
  ok "no secret, no PAT: only the default token"
fi

# WHY the file name must not appear in ci.yml at all: the gate job there is the single required
# check, and a job referenced by it runs on every PR. An advisory nightly scan in that list is a
# merge gate on data the PR did not cause, which is how required checks get bypassed.
if [ -f "$CI" ] && grep -q 'image-scan' "$CI"; then
  no "ci.yml references image-scan — the nightly scan must not reach the required CI aggregator"
else
  ok "ci.yml does not reference image-scan (no merge gate)"
fi

if [ -f "$CI" ] && grep -qE '^  gate:' "$CI" && grep -qE '^    name: CI$' "$CI"; then
  ok "ci.yml still has its single CI gate (the absence above is about a real gate)"
else
  no "ci.yml has no gate job named CI — this suite cannot tell whether the scan is gating"
fi

printf '\n== discovery: every pinned third-party image, nothing hardcoded ==\n'

if [ ! -f "$SCAN" ]; then
  no "scripts/__image_scan.sh is missing — the workflow has nothing to run"
else
  ok "scripts/__image_scan.sh exists"

  # Independent inventory: the same rules the pin gate uses, written differently on purpose so a
  # bug in the script cannot also be the expectation.
  expected="$tmp/expected.txt"
  for f in "${REPO_ROOT}"/docker-compose*.yml "${REPO_ROOT}"/docker/docker-compose*.yml; do
    [ -f "$f" ] || continue
    case "$f" in *generated*) continue ;; esac
    if git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1 &&
       git -C "$REPO_ROOT" check-ignore -q -- "$f" 2>/dev/null; then
      continue
    fi
    grep -hE '^[[:space:]]*image:[[:space:]]*' "$f"
  done |
    sed -E 's/^[[:space:]]*image:[[:space:]]*//' |
    sed -E 's/^\$\{[A-Za-z_][A-Za-z0-9_]*:-(.*)\}$/\1/' |
    sed -E 's/^"//; s/"$//' |
    grep -v '^ghcr.io/champyod/' |
    sed -E 's#^docker\.io/library/##; s#^docker\.io/##; s#^index\.docker\.io/##' |
    sort -u > "$expected"

  actual="$tmp/actual.txt"
  bash "$SCAN" refs > "$actual" 2>/dev/null
  sed -i -E 's#^docker\.io/library/##; s#^docker\.io/##; s#^index\.docker\.io/##' "$actual" 2>/dev/null
  sort -u -o "$actual" "$actual"

  if [ -s "$actual" ]; then
    ok "refs mode reports $(grep -c . "$actual") third-party refs"
  else
    no "refs mode reported nothing — the scan, not the tree, is broken"
  fi

  if [ -s "$expected" ] && diff -q "$expected" "$actual" >/dev/null 2>&1; then
    ok "every third-party ref in the compose files is discovered, and nothing extra"
  else
    no "discovered refs do not match the compose files: $(diff "$expected" "$actual" 2>/dev/null | tr '\n' ' ')"
  fi

  if [ -n "$actual" ] && ! grep -q '^ghcr.io/champyod/' "$actual"; then
    ok "our own images (ghcr.io/champyod/*) are skipped"
  else
    no "an own image leaked into the scan set"
  fi

  # The skip is only meaningful if those refs exist: otherwise it proves nothing.
  if grep -hE '^[[:space:]]*image:[[:space:]]*ghcr\.io/champyod/' "${REPO_ROOT}"/docker-compose*.yml 2>/dev/null | grep -q .; then
    ok "the compose files do ship own images (so the skip above is real)"
  else
    no "no own images found in the compose files — the skip assertion proves nothing"
  fi

  # ${VAR:-default} indirection: the default is what a checkout runs, so it must be resolved.
  if grep -qE '^\s*image:\s*\$\{[A-Za-z_][A-Za-z0-9_]*:-[^}]+\}' "${REPO_ROOT}"/docker-compose*.yml 2>/dev/null; then
    if grep -qF 'certbot/certbot:' "$actual"; then
      ok "an interpolated \${VAR:-default} ref resolves to its default"
    else
      no '\${VAR:-default} was not resolved — the interpolated image is not scanned'
    fi
  else
    no "no interpolated image ref found — this assertion no longer covers anything"
  fi

  # No hardcoded list, in either half: the workflow's code names no image, the script pins no
  # digest. Comments are stripped first — the header prose cites the measured example by name,
  # which is documentation of the gap, not an inventory the scan reads.
  sed -E 's/^[[:space:]]*#.*$//' "$WF" 2>/dev/null > "$tmp/wf-code.txt"
  sed -E 's/^[[:space:]]*#.*$//' "$SCAN" 2>/dev/null > "$tmp/scan-code.txt"
  hardcoded=0
  while IFS= read -r ref; do
    repo_tag="${ref%%@sha256:*}"
    if grep -qF -- "$repo_tag" "$tmp/wf-code.txt" 2>/dev/null; then hardcoded=1; fi
    digest="${ref##*@sha256:}"
    if grep -qF -- "$digest" "$tmp/scan-code.txt" 2>/dev/null; then hardcoded=1; fi
  done < "$actual"
  if [ "$hardcoded" -eq 0 ]; then
    ok "no hardcoded image list (the workflow names no image, the script pins no digest)"
  else
    no "an image ref or digest is hardcoded in the workflow/script"
  fi

  if grep -qE 'docker-compose\*\.yml' "$SCAN"; then
    ok "the inventory comes from the docker-compose*.yml glob"
  else
    no "the script does not read the compose files"
  fi
fi

printf '\n== waivers are applied exactly as CI applies them ==\n'

if grep -qF 'scripts/__security_waivers.sh render --trivy .trivyignore' "$WF" 2>/dev/null; then
  ok "the workflow renders the waiver suppressions to .trivyignore"
  render_line="$(grep -nE 'security_waivers.sh render' "$WF" | head -1 | cut -d: -f1)"
  scan_line="$(grep -nE '__image_scan.sh scan' "$WF" | head -1 | cut -d: -f1)"
  if [ -n "$render_line" ] && [ -n "$scan_line" ] && [ "$render_line" -lt "$scan_line" ]; then
    ok "the render step runs before the scan step"
  else
    no "the render step is not ordered before the scan (render=${render_line:-?} scan=${scan_line:-?})"
  fi
else
  no "the workflow does not render waivers — a live waiver would read as a failure"
fi

if grep -qE '^\.trivyignore$' "${REPO_ROOT}/.gitignore" 2>/dev/null; then
  ok ".trivyignore is generated and gitignored (no tracked ignore file)"
else
  no ".trivyignore is not gitignored — a committed ignore file would bypass the waiver table"
fi

if grep -qE 'trivyignore\.[a-z]|\.customignore|ignore-file\.txt' "$SCAN" "$WF" "${REPO_ROOT}"/scripts/__security_waivers.sh 2>/dev/null; then
  no "a second ignore file appears — the waiver table is the only suppression mechanism"
else
  ok "no second ignore file: the waiver table is the only suppression"
fi

if grep -qF -- '--ignore-unfixed' "$SCAN" 2>/dev/null; then
  ok "the policy run ignores unfixed findings (the same rule as ci.yml)"
else
  no "the scan does not pass --ignore-unfixed — the unfixed tail would fail every night"
fi

if grep -qF -- '--severity "$SEVERITY"' "$SCAN" 2>/dev/null && grep -qF 'CRITICAL,HIGH' "$SCAN"; then
  ok "severity is CRITICAL,HIGH"
else
  no "severity is not CRITICAL,HIGH"
fi

if grep -qF -- '--ignorefile "/waivers/' "$SCAN" 2>/dev/null; then
  ok "trivy is handed the rendered ignore file"
else
  no "trivy is not handed the rendered waiver file"
fi

# Exit 1 is the policy verdict. The script must distinguish it from "no verdict" (2), or a
# scanner that could not reach an answer would be published as a result.
if grep -qF -- 'trivy_run "${slug}.fixable.json" 1' "$SCAN" 2>/dev/null &&
   grep -qF -- '--exit-code "$exit_code"' "$SCAN" 2>/dev/null &&
   grep -qE 'die "scan incomplete' "$SCAN" 2>/dev/null; then
  ok "exit 1 = fixable findings, exit 2 = no verdict (they are not conflated)"
else
  no "the scan does not separate 'fixable findings' from 'could not tell'"
fi

# Hermetic: point the waiver path at a file that does not exist. The scan must refuse before it
# pulls anything — an unwaived scan would report every waived id as a fresh finding.
printf 'example:1@sha256:%064d\n' 0 > "$tmp/one.txt"
out_missing="$(IMAGE_SCAN_WAIVER_FILE="$tmp/no-such-ignore" bash "$SCAN" scan --refs "$tmp/one.txt" --out "$tmp/out-missing" 2>&1)"
rc_missing=$?
if [ "$rc_missing" -ne 0 ] && printf '%s' "$out_missing" | grep -q 'render the waivers'; then
  ok "scan refuses to run without the rendered waiver file (exit ${rc_missing}, names the render command)"
else
  no "scan ran without the rendered waivers (exit ${rc_missing}) — waivers would silently not apply"
fi

printf '\n== notification: one upserted issue, not one per night ==\n'

if grep -qF "const title = 'Nightly image scan: fixable CVEs';" "$WF" 2>/dev/null; then
  ok "the issue title is a stable constant"
else
  no "no stable issue title — every run would open a new issue"
fi

if grep -qF "state: 'all'" "$WF" 2>/dev/null && grep -qF 'listForRepo' "$WF" 2>/dev/null; then
  ok "it looks for the issue in all states (a closed issue is found, not duplicated)"
else
  no "it only looks at open issues — the clean-then-findings cycle would open duplicates"
fi

if grep -qE 'issues\.update' "$WF" 2>/dev/null && grep -qE 'issues\.create' "$WF" 2>/dev/null; then
  ok "the body is replaced on the existing issue (create only when absent)"
else
  no "it does not upsert (no create/update pair)"
fi

if grep -qF "state === 'clean' ? 'closed' : 'open'" "$WF" 2>/dev/null; then
  ok "a clean run closes the issue"
else
  no "a clean run does not close the issue"
fi

if grep -qF 'Clean as of' "$SCAN" 2>/dev/null; then
  ok "the closed body is a one-line 'clean as of <date>'"
else
  no "the closed body does not say when it was checked"
fi

if grep -qF 'INCOMPLETE RUN' "$SCAN" 2>/dev/null && grep -qF "state = fs.existsSync" "$WF" 2>/dev/null; then
  ok "a run without a verdict replaces the body with INCOMPLETE (yesterday's table cannot read as current)"
else
  no "an incomplete run would leave the previous body standing as if it were current"
fi

if grep -qF 'image-scan:state=' "$SCAN" 2>/dev/null; then
  ok "the body carries a hidden state marker"
else
  no "no hidden state marker in the issue body"
fi

if grep -qF 'GITHUB_STEP_SUMMARY' "$WF" 2>/dev/null; then
  ok "the table is published to the job summary as well as the issue"
else
  no "no job summary — the unfixed tail would only be visible in the issue"
fi

if grep -qE 'top packages|top 3' "$SCAN" 2>/dev/null; then
  ok "the table carries total findings, fixable count and top packages"
else
  no "the table does not carry the per-ref package breakdown"
fi

printf '\n== digest drift: a check that cannot run reads as unknown ==\n'

if grep -qF '__image_scan.sh drift' "$WF" 2>/dev/null; then
  ok "the workflow runs the drift check"
else
  no "the workflow does not check pinned digests against the registries"
fi

if grep -qF 'auth.docker.io/token' "$SCAN" 2>/dev/null && grep -qF 'ghcr.io/token' "$SCAN" 2>/dev/null; then
  ok "both registry token flows are implemented (Docker Hub + GHCR anonymous)"
else
  no "a registry token flow is missing"
fi

if grep -qF '429' "$SCAN" 2>/dev/null && grep -qF 'retry_after' "$SCAN" 2>/dev/null; then
  ok "HTTP 429 is retried with the Retry-After header"
else
  no "429 is not handled — a rate limit would be recorded as a result"
fi

if grep -qF '401|403)' "$SCAN" 2>/dev/null || grep -qF '401|403' "$SCAN" 2>/dev/null; then
  ok "401/403 (a repo we do not own) is a distinct outcome"
else
  no "401/403 is not distinguished — an unreadable repo could read as fine"
fi

# The three registry answers, through a curl shim: same digest, different digest, and 429. The
# point of the third case is the only one that matters: it must NOT say up to date.
mkdir -p "$tmp/bin"
cat > "$tmp/bin/curl" <<'SHIM'
#!/usr/bin/env bash
# Test double: no network. Answers the token POST and the manifest HEAD the script issues.
hdr=""; prev=""
for a in "$@"; do
  [ "$prev" = "-D" ] && hdr="$a"
  prev="$a"
done
if [ -z "$hdr" ]; then
  printf '{"token":"shim-token"}'
  exit 0
fi
code="${SHIM_CODE:-200}"
{
  printf 'HTTP/1.1 %s\r\n' "$code"
  [ -n "${SHIM_DIGEST:-}" ] && printf 'Docker-Content-Digest: %s\r\n' "$SHIM_DIGEST"
  [ "$code" = "429" ] && printf 'Retry-After: 0\r\n'
  printf '\r\n'
} > "$hdr"
printf '%s' "$code"
SHIM
chmod +x "$tmp/bin/curl"

pin="$(grep -v '^$' "$tmp/actual.txt" 2>/dev/null | head -1)"
pin="${pin:-example:1@sha256:$(printf '%064d' 0)}"
digest_only="${pin##*@}"
printf '%s\n' "$pin" > "$tmp/drift-ref.txt"

status_of() {
  rm -rf "$tmp/drift-out"
  PATH="$tmp/bin:$PATH" "$@" bash "$SCAN" drift --refs "$tmp/drift-ref.txt" --out "$tmp/drift-out" >/dev/null 2>&1
  cut -f4 "$tmp/drift-out/drift.tsv" 2>/dev/null | head -1
}
# shellcheck disable=SC2086
same="$(status_of env SHIM_CODE=200 SHIM_DIGEST="$digest_only")"
# shellcheck disable=SC2086
moved="$(status_of env SHIM_CODE=200 SHIM_DIGEST="sha256:$(printf '%064d' 1)")"
# shellcheck disable=SC2086
limited="$(status_of env SHIM_CODE=429)"

if [ "$same" = "ok" ]; then
  ok "a tag serving the pinned digest reads as ok"
else
  no "the matching-digest case did not read as ok (got '${same}')"
fi
if [ "$moved" = "drift" ]; then
  ok "a tag serving a different digest reads as drift"
else
  no "the moved-digest case did not read as drift (got '${moved}')"
fi
if [ "$limited" = "unknown" ]; then
  ok "a rate-limited check reads as unknown, never as up to date"
else
  no "a 429 read as '${limited}' — an unrunnable check must say unknown"
fi

printf '\n== every action is pinned to a commit ==\n'

unpinned=0
uses_count=0
while IFS= read -r line; do
  uses_count=$((uses_count + 1))
  if ! printf '%s' "$line" | grep -qE 'uses: [^ ]+@[0-9a-f]{40} # v[0-9]'; then
    unpinned=$((unpinned + 1))
    printf '       unpinned: %s\n' "$(printf '%s' "$line" | sed -E 's/^ +//')"
  fi
done < <(grep -E '^ +uses:' "$WF" 2>/dev/null)
if [ "$uses_count" -gt 0 ] && [ "$unpinned" -eq 0 ]; then
  ok "all ${uses_count} uses: are SHA-pinned with a version comment"
else
  no "${unpinned} of ${uses_count} uses: are not SHA-pinned with a version comment"
fi

printf '\nPASS: %d  FAIL: %d\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
