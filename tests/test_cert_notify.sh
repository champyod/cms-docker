#!/usr/bin/env bash
# Drives scripts/__cert_notify.sh against a sandboxed checkout with a stub curl and a
# throwaway certificate, so what the sender does on a no-op tick, a real renewal and an
# approaching expiry is assertable without a timer, a webhook or a live certificate.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
CERT_NOTIFY="${REPO_ROOT}/scripts/__cert_notify.sh"
SERVICE_UNIT="${REPO_ROOT}/config/systemd/grader-cert-renew.service"
SENTINEL_URL='https://discord.example.invalid/api/webhooks/000000000000/sentinel-token'
LINEAGE='example.test'

pass=0
fail=0
SANDBOXES=()

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

cleanup() { rm -rf "${SANDBOXES[@]+"${SANDBOXES[@]}"}"; }
trap cleanup EXIT

# A copy of the checkout pieces the script reaches for, plus a stub curl that records what
# it was handed. WHY a stub and not the real curl: the request must never leave the machine.
sandbox() {
  local dir
  dir="$(mktemp -d "${TMPDIR:-/tmp}/cert-notify.XXXXXX")"
  SANDBOXES+=("${dir}")
  mkdir -p "${dir}/scripts/__lib" "${dir}/bin" "${dir}/home" "${dir}/config/letsencrypt/live/${LINEAGE}"
  cp "${CERT_NOTIFY}" "${dir}/scripts/"
  cp "${REPO_ROOT}/scripts/__lib/common.sh" "${dir}/scripts/__lib/"
  # WHY the real Makefile and ./cms rather than stubs: the repo-root walk looks for exactly
  # those two, so a hand-made pair would assert the stub rather than the checkout shape.
  cp "${REPO_ROOT}/Makefile" "${dir}/Makefile"
  cp "${REPO_ROOT}/cms" "${dir}/cms"
  cat > "${dir}/bin/curl" <<'STUB'
#!/usr/bin/env bash
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
  printf 'DOMAIN_NAME=%s\nCERT_LINEAGE_DOMAIN=%s\nDISCORD_WEBHOOK_URL=%s\nACME_RENEW_BEFORE_DAYS=7\n' \
    "${LINEAGE}" "${LINEAGE}" "${SENTINEL_URL}" > "${dir}/.env"
  printf '%s' "${dir}"
}

# A self-signed certificate in the sandbox lineage, so openssl has something real to read.
make_cert() {
  local dir="$1" days="$2"
  openssl req -x509 -newkey rsa:2048 -nodes -days "${days}" -subj "/CN=${LINEAGE}" \
    -keyout "${dir}/config/letsencrypt/live/${LINEAGE}/privkey.pem" \
    -out "${dir}/config/letsencrypt/live/${LINEAGE}/fullchain.pem" 2>/dev/null
}

cert_enddate() { openssl x509 -noout -enddate -in "${1}/config/letsencrypt/live/${LINEAGE}/fullchain.pem" 2>/dev/null | sed 's/^notAfter=//'; }
cert_fp()      { openssl x509 -noout -fingerprint -sha256 -in "${1}/config/letsencrypt/live/${LINEAGE}/fullchain.pem" 2>/dev/null | sed 's/^.*=//'; }

state_write() { # <dir> <fingerprint> <warned_for>
  printf 'FINGERPRINT=%s\nWARNED_FOR=%s\n' "$2" "$3" > "$1/config/letsencrypt/.cert-notify-state"
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

curl_ran() { [[ -e "$1/curl.argv" ]]; }

# The embed as a single line of field "name=value" pairs, so a fixed-string search works on it.
embed_fields() {
  python3 -c 'import json,sys
with open(sys.argv[1], encoding="utf-8") as handle:
    embed = json.load(handle)["embeds"][0]
print(embed["title"])
for field in embed.get("fields", []):
    print("%s=%s" % (field["name"], field["value"]))' "$1" 2>/dev/null
}

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl not found — the certificate notification tests need it" >&2
  exit 1
fi

echo "the first observation is recorded, not reported as a renewal"
dir="$(sandbox)"
make_cert "${dir}" 90
out="$(run_notify "${dir}")"
status=$?
if [[ "${status}" -eq 0 ]]; then
  ok "a fresh certificate exits 0"
else
  no "a fresh certificate exits 0 (status ${status}: ${out})"
fi
if curl_ran "${dir}"; then
  no "no alert is posted for a certificate that was never seen before"
else
  ok "no alert is posted for a certificate that was never seen before"
fi
if grep -qF 'no alert' <<<"${out}"; then
  ok "the first observation says what it did"
else
  no "the first observation says what it did (got: ${out})"
fi

echo "an unchanged certificate stays silent on the next tick"
out="$(run_notify "${dir}")"
status=$?
if [[ "${status}" -eq 0 ]]; then
  ok "an unchanged certificate exits 0"
else
  no "an unchanged certificate exits 0 (status ${status}: ${out})"
fi
if curl_ran "${dir}"; then
  no "an unchanged certificate posts nothing"
else
  ok "an unchanged certificate posts nothing"
fi
if grep -qF 'no alert' <<<"${out}"; then
  ok "the no-op is stated rather than silent"
else
  no "the no-op is stated rather than silent (got: ${out})"
fi

echo "a rotated certificate posts one embed with domain, issuer and expiry"
dir="$(sandbox)"
make_cert "${dir}" 90
run_notify "${dir}" >/dev/null 2>&1
old_fp="$(cert_fp "${dir}")"
make_cert "${dir}" 90
new_fp="$(cert_fp "${dir}")"
rm -f "${dir}/curl.argv" "${dir}/curl.body" "${dir}/curl.conf"
out="$(run_notify "${dir}")"
status=$?
if [[ "${status}" -eq 0 ]]; then
  ok "the renewal run exits 0"
else
  no "the renewal run exits 0 (status ${status}: ${out})"
fi
if [[ -n "${new_fp}" && "${new_fp}" != "${old_fp}" ]]; then
  ok "the replacement certificate has a new fingerprint"
else
  no "the replacement certificate has a new fingerprint"
fi
if curl_ran "${dir}"; then
  ok "the renewal posts an alert"
else
  no "the renewal posts an alert (got: ${out})"
fi
expected_expiry="$(cert_enddate "${dir}")"
argv="$(tr '\0' '\n' < "${dir}/curl.argv" 2>/dev/null || true)"
if python3 -c 'import json, os, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    embed = json.load(handle)["embeds"][0]
assert "renewed" in embed["title"], embed["title"]
assert os.uname().nodename in embed["description"], embed["description"]
fields = {f["name"]: f["value"] for f in embed.get("fields", [])}
assert fields.get("Domain") == sys.argv[2], fields
assert fields.get("Issuer"), fields
assert fields.get("Expires") == sys.argv[3], fields' "${dir}/curl.body" "${LINEAGE}" "${expected_expiry}" 2>/dev/null; then
  ok "the embed carries the renewal, the domain, the issuer and the new expiry"
else
  no "the embed carries the renewal, the domain, the issuer and the new expiry (got: $(cat "${dir}/curl.body" 2>/dev/null))"
fi
if grep -qF '{"embeds"' <<<"${argv}"; then
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
  no "the webhook token is in the curl config file (got: $(cat "${dir}/curl.conf" 2>/dev/null))"
fi
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
  no "the body is handed over as one -d @<file> argument"
fi

echo "a certificate already near expiry is announced once, then silent"
dir="$(sandbox)"
make_cert "${dir}" 3
state_write "${dir}" "$(cert_fp "${dir}")" ""
out="$(run_notify "${dir}")"
if curl_ran "${dir}"; then
  ok "the approaching expiry posts an alert"
else
  no "the approaching expiry posts an alert (got: ${out})"
fi
if python3 -c 'import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    embed = json.load(handle)["embeds"][0]
assert "expiring" in embed["title"], embed["title"]
assert "day(s)" in embed["description"], embed["description"]
fields = {f["name"]: f["value"] for f in embed.get("fields", [])}
assert fields.get("Domain") and fields.get("Expires"), fields' "${dir}/curl.body" 2>/dev/null; then
  ok "the expiry embed names the domain and the expiry"
else
  no "the expiry embed names the domain and the expiry (got: $(cat "${dir}/curl.body" 2>/dev/null))"
fi
rm -f "${dir}/curl.argv"
run_notify "${dir}" >/dev/null 2>&1
if curl_ran "${dir}"; then
  no "the same approaching expiry is not announced twice"
else
  ok "the same approaching expiry is not announced twice"
fi

echo "CERT_NOTIFY_ENABLED=0 silences the sender"
dir="$(sandbox)"
printf 'CERT_NOTIFY_ENABLED=0\n' >> "${dir}/.env"
make_cert "${dir}" 3
out="$(run_notify "${dir}")"
status=$?
if [[ "${status}" -eq 0 ]] && ! curl_ran "${dir}"; then
  ok "a disabled sender posts nothing and exits 0"
else
  no "a disabled sender posts nothing and exits 0 (status ${status}: ${out})"
fi
if grep -qF 'notifications disabled' <<<"${out}"; then
  ok "the disable switch is stated rather than silent"
else
  no "the disable switch is stated rather than silent (got: ${out})"
fi

echo "a checkout with no webhook sends nothing and says so"
dir="$(sandbox)"
printf 'DISCORD_WEBHOOK_URL=\n' > "${dir}/.env"
make_cert "${dir}" 3
out="$(run_notify "${dir}")"
status=$?
if [[ "${status}" -eq 0 ]] && ! curl_ran "${dir}"; then
  ok "an empty webhook exits 0 without invoking curl"
else
  no "an empty webhook exits 0 without invoking curl (status ${status}: ${out})"
fi
if grep -qF 'notification skipped' <<<"${out}"; then
  ok "the skip is stated rather than silent"
else
  no "the skip is stated rather than silent (got: ${out})"
fi

echo "a checkout with no .env at all is equally quiet"
dir="$(sandbox)"
rm -f "${dir}/.env"
make_cert "${dir}" 3
out="$(run_notify "${dir}")"
status=$?
if [[ "${status}" -eq 0 ]] && ! curl_ran "${dir}"; then
  ok "a missing .env exits 0 without invoking curl"
else
  no "a missing .env exits 0 without invoking curl (status ${status}: ${out})"
fi

echo "a store with no certificate is reported, not posted"
dir="$(sandbox)"
rm -rf "${dir}/config/letsencrypt/live/${LINEAGE}"
out="$(run_notify "${dir}")"
status=$?
if [[ "${status}" -eq 0 ]] && ! curl_ran "${dir}"; then
  ok "a missing certificate exits 0 without invoking curl"
else
  no "a missing certificate exits 0 without invoking curl (status ${status}: ${out})"
fi
if grep -qF 'nothing to announce' <<<"${out}"; then
  ok "the empty store is stated rather than silent"
else
  no "the empty store is stated rather than silent (got: ${out})"
fi

echo "a Discord outage does not fail a successful renewal"
dir="$(sandbox)"
make_cert "${dir}" 3
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
