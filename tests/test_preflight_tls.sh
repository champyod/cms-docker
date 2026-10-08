#!/usr/bin/env bash
# Exercises the real check_certbot_issuance() mapping out of __preflight.sh: a failed
# issuance WARNs so config sync completes, while a status/filesystem disagreement (4)
# FAILs. The function is extracted, not re-declared, so a dropped case arm fails here.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
PREFLIGHT="${REPO_ROOT}/scripts/__preflight.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

# Sandbox for the stub __certbot_status.sh and the exit code it reads.
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "${SANDBOX}/scripts"
RC_FILE="${SANDBOX}/.stub_rc"
printf '0' > "$RC_FILE"
cat > "${SANDBOX}/scripts/__certbot_status.sh" <<'STUB'
#!/usr/bin/env bash
rc="$(cat "${STUB_RC_FILE:-/dev/null}" 2>/dev/null || echo 0)"
case "$rc" in
  0) echo "certbot: certificate present for x.example.org" ;;
  1) echo "certbot: issuance pending for x.example.org" ;;
  2) echo "certbot: issuance failed for x.example.org" ;;
  3) echo "certbot: grader-certbot is not running" ;;
  4) echo "certbot: status claims a certificate for x but live/x is absent" ;;
esac
exit "$rc"
STUB
chmod +x "${SANDBOX}/scripts/__certbot_status.sh"

# The function under test, pulled straight out of __preflight.sh.
fn="$(awk '/^check_certbot_issuance\(\) \{$/ { keep = 1 } keep { print } /^\}$/ && keep { keep = 0 }' "$PREFLIGHT")"

if [[ -n "$fn" ]]; then
  ok "check_certbot_issuance() extracted from __preflight.sh"
else
  no "check_certbot_issuance() extracted from __preflight.sh"
  exit 1
fi

# Stub record_result to capture the name/status/detail the function records.
declare -a RECORDED=()
record_result() { RECORDED+=("$1|$2|$3"); }

# Point the extracted function at the sandbox's stub status helper.
REPO_ROOT="$SANDBOX"
export STUB_RC_FILE="$RC_FILE"

# shellcheck disable=SC1090
eval "$fn"

# rc -> recorded verdict: 2 WARNs (issuance), 4 FAILs (status/filesystem mismatch).
declare -A EXPECT=(
  [0]="PASS"
  [1]="WARN"
  [2]="WARN"
  [3]="PASS"
  [4]="FAIL"
)

for rc in 0 1 2 3 4; do
  printf '%s' "$rc" > "$RC_FILE"
  RECORDED=()
  check_certbot_issuance
  got="${RECORDED[0]:-}"
  name="${got%%|*}"
  rest="${got#*|}"
  status="${rest%%|*}"
  if [[ "$name" == "tls certificate" && "$status" == "${EXPECT[$rc]}" ]]; then
    ok "rc=$rc -> ${EXPECT[$rc]}"
  else
    no "rc=$rc -> ${EXPECT[$rc]} (got: ${got:-<nothing recorded>})"
  fi
done

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
