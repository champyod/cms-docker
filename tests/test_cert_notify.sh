#!/usr/bin/env bash
# Drives scripts/__cert_notify.sh against a sandboxed checkout with a stub curl, so what the
# sender hands to the network is assertable without a timer, a webhook or a certificate.
#
# WHY this exists: the unit built its alert inline, where systemd expanded the webhook
# reference to nothing and split the JSON across argv, and the command ended in `|| true` —
# so the service reported success for an hour of resolve errors and no test could see it.
# These assertions read the payload, the argv and the unit's own command line.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
CERT_NOTIFY="${REPO_ROOT}/scripts/__cert_notify.sh"
SERVICE_UNIT="${REPO_ROOT}/config/systemd/grader-cert-renew.service"
SENTINEL_URL='https://discord.example.invalid/api/webhooks/000000000000/sentinel-token'

pass=0
fail=0
# One sandbox per case: each stages its own .env and its own curl logs, so they cannot see
# one another's leftovers.
SANDBOXES=()

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

cleanup() { rm -rf "${SANDBOXES[@]+"${SANDBOXES[@]}"}"; }
trap cleanup EXIT

# A copy of the checkout pieces the script reaches for, plus a stub curl that records what
# it was handed. WHY a stub and not the real curl: the claims under test are where the token
# and the body sit, so the request must never leave the machine.
sandbox() {
  local dir
  dir="$(mktemp -d "${TMPDIR:-/tmp}/cert-notify.XXXXXX")"
  SANDBOXES+=("${dir}")
  mkdir -p "${dir}/scripts/__lib" "${dir}/bin" "${dir}/home"
  cp "${CERT_NOTIFY}" "${dir}/scripts/"
  cp "${REPO_ROOT}/scripts/__lib/common.sh" "${dir}/scripts/__lib/"
  # WHY the real Makefile and ./cms rather than stubs: the repo-root walk looks for exactly
  # those two, so a hand-made pair would assert the stub rather than the checkout shape.
  cp "${REPO_ROOT}/Makefile" "${dir}/Makefile"
  cp "${REPO_ROOT}/cms" "${dir}/cms"
  cat > "${dir}/bin/curl" <<'STUB'
#!/usr/bin/env bash
# Records its own argv, then the body and the config it was handed. The body is removed the
# moment this returns, so reading it here is the only chance a case gets.
printf '%s\0' "$@" > "${CURL_ARGV_LOG}"
: > "${CURL_BODY_LOG}"
: > "${CURL_CONF_LOG}"
body=''
conf=''
while (( $# )); do
  case "$1" in
    -d|--data-binary) body="${2:-}" ;;
    -K|--config)     conf="${2:-}" ;;
  esac
  shift
done
case "${body}" in
  @*) cat -- "${body#@}" > "${CURL_BODY_LOG}" 2>/dev/null || : ;;
esac
case "${conf}" in
  ?*) cat -- "${conf}" > "${CURL_CONF_LOG}" 2>/dev/null || : ;;
esac
exit "${CURL_STUB_STATUS:-0}"
STUB
  chmod +x "${dir}/bin/curl"
  printf '%s' "${dir}"
}

# The sandbox bin comes first on PATH so the real curl is never reached, and HOME points
# inside the sandbox so nothing reads the operator's own environment.
run_notify() {
  local dir="$1"
  CURL_ARGV_LOG="${dir}/curl.argv" \
  CURL_BODY_LOG="${dir}/curl.body" \
  CURL_CONF_LOG="${dir}/curl.conf" \
  CURL_STUB_STATUS="${CURL_STUB_STATUS:-0}" \
  PATH="${dir}/bin:${PATH}" HOME="${dir}/home" \
    bash "${dir}/scripts/__cert_notify.sh" 2>&1
}

# argv as one entry per line, so a count and a fixed-string search both work on it.
argv_lines() {
  tr '\0' '\n' < "$1" 2>/dev/null || true
}

echo "a webhook in .env is delivered as one intact payload"
dir="$(sandbox)"
printf 'DISCORD_WEBHOOK_URL=%s\n' "${SENTINEL_URL}" > "${dir}/.env"
out="$(run_notify "${dir}")"
status=$?
if [[ "${status}" -eq 0 ]]; then
  ok "the script exits 0"
else
  no "the script exits 0 (status ${status}: ${out})"
fi
argv="$(argv_lines "${dir}/curl.argv")"
if [[ "$(grep -c '^@' <<<"${argv}" || true)" -eq 1 ]]; then
  ok "the payload is one argv entry, not one entry per word"
else
  no "the payload is one argv entry, not one entry per word (argv: ${argv})"
fi
# WHY the pairing is checked rather than a fixed-string match for "-d @": a flag and its
# value are two argv entries by construction, so the claim being made is that the value
# immediately after the flag is one whole path. The path is not asserted to still exist —
# the sender removes it the moment curl returns — so the proof that it named a readable body
# is the stub having read it, which the JSON case below settles.
if python3 -c 'import sys
with open(sys.argv[1], "rb") as handle:
    argv = [entry.decode() for entry in handle.read().split(b"\0")[:-1]]
for index, entry in enumerate(argv):
    if entry in ("-d", "--data-binary"):
        assert argv[index + 1].startswith("@"), argv[index + 1]
        break
else:
    raise AssertionError("no -d or --data-binary in %r" % argv)' "${dir}/curl.argv" 2>/dev/null; then
  ok "the body is handed over as one -d @<file> argument"
else
  no "the body is handed over as one -d @<file> argument (argv: ${argv})"
fi
if grep -qF '{"content"' <<<"${argv}"; then
  no "no part of the payload is left in argv"
else
  ok "no part of the payload is left in argv"
fi
if grep -qF -- "${SENTINEL_URL}" <<<"${argv}"; then
  no "the webhook token is not in argv"
else
  ok "the webhook token is not in argv"
fi
if grep -qF -- "${SENTINEL_URL}" "${dir}/curl.conf"; then
  ok "the webhook token is in the curl config file"
else
  no "the webhook token is in the curl config file (got: $(cat "${dir}/curl.conf"))"
fi

echo "the payload is the JSON Discord is asked to accept"
# WHY python3 and not a regex: a payload can be word-split and still contain every substring
# it should, so only a parser settles whether it is one JSON value or several.
if python3 -c 'import json, os, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    message = json.load(handle)["content"]
assert ":lock: SSL cert renewed on " in message, message
assert os.uname().nodename in message, message' "${dir}/curl.body" 2>/dev/null; then
  ok "the payload parses as JSON and names this host"
else
  no "the payload parses as JSON and names this host (got: $(cat "${dir}/curl.body" 2>/dev/null))"
fi

echo "a checkout with no webhook sends nothing and says so"
dir="$(sandbox)"
printf 'DISCORD_WEBHOOK_URL=\n' > "${dir}/.env"
out="$(run_notify "${dir}")"
status=$?
if [[ "${status}" -eq 0 ]]; then
  ok "an empty webhook exits 0"
else
  no "an empty webhook exits 0 (status ${status}: ${out})"
fi
if [[ ! -e "${dir}/curl.argv" ]]; then
  ok "no payload is staged and curl is never invoked"
else
  no "no payload is staged and curl is never invoked"
fi
if grep -qF 'renewal notification skipped' <<<"${out}"; then
  ok "the skip is stated rather than silent"
else
  no "the skip is stated rather than silent (got: ${out})"
fi

echo "a checkout with no .env at all is equally quiet"
dir="$(sandbox)"
out="$(run_notify "${dir}")"
status=$?
if [[ "${status}" -eq 0 ]] && [[ ! -e "${dir}/curl.argv" ]]; then
  ok "a missing .env exits 0 without invoking curl"
else
  no "a missing .env exits 0 without invoking curl (status ${status}: ${out})"
fi

echo "a Discord outage does not fail a successful renewal"
# WHY this case exists at all: the exit status the unit relied on came from `|| true`, and
# the cost of that was a broken sender nobody could hear about. The status is now the
# script's own decision, so it is asserted rather than assumed.
dir="$(sandbox)"
printf 'DISCORD_WEBHOOK_URL=%s\n' "${SENTINEL_URL}" > "${dir}/.env"
CURL_STUB_STATUS=1
out="$(run_notify "${dir}")"
status=$?
if [[ "${status}" -eq 0 ]]; then
  ok "a failed POST still exits 0"
else
  no "a failed POST still exits 0 (status ${status}: ${out})"
fi
if grep -qF '[WARN]' <<<"${out}"; then
  ok "the failure is warned about, not swallowed"
else
  no "the failure is warned about, not swallowed (got: ${out})"
fi

echo "the unit carries nothing systemd would rewrite before bash runs it"
# WHY each of the four: an escaped quote pair and an environment-variable reference are what
# systemd rewrites before bash sees the line, a percent sign is a specifier it expands to
# something else, and the payload flag is what a word-split body arrived as. A unit carrying
# any of them is no longer the command it reads as.
for pattern in '\"' '${' '%' '-d "{\"'; do
  if grep -qF -- "${pattern}" "${SERVICE_UNIT}"; then
    no "the service unit carries no $(printf '%q' "${pattern}")"
  else
    ok "the service unit carries no $(printf '%q' "${pattern}")"
  fi
done
if grep -qE '^ExecStartPost=/usr/bin/env bash @CMS_DIR@/scripts/__cert_notify\.sh$' "${SERVICE_UNIT}"; then
  ok "ExecStartPost runs the notify script"
else
  no "ExecStartPost runs the notify script"
fi

printf '\n%s passed, %s failed\n' "${pass}" "${fail}"
(( fail == 0 ))
