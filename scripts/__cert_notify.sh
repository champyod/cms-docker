#!/usr/bin/env bash
# scripts/__cert_notify.sh — announce a real renewal, or an approaching expiry, to Discord.
# Run as the cert-renew unit's ExecStartPost, so it observes the certificate a renewal left behind.
set -eu
if (set -o pipefail 2>/dev/null); then
  set -o pipefail
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "${SCRIPT_DIR}/__lib/common.sh" ]]; then
  printf '[FAIL] %s\n' "missing ${SCRIPT_DIR}/__lib/common.sh — deliver scripts/__lib beside this script" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

readonly CERT_STORE_REL="config/letsencrypt"
readonly NOTIFY_STATE_NAME=".cert-notify-state"
readonly DEFAULT_RENEW_BEFORE_DAYS=7
readonly STATE_KEY_FINGERPRINT="FINGERPRINT"
readonly STATE_KEY_WARNED_FOR="WARNED_FOR"

repo_root() {
  local dir="${SCRIPT_DIR}"
  while [[ "${dir}" != '/' ]]; do
    if [[ -f "${dir}/Makefile" && -x "${dir}/cms" ]]; then
      printf '%s' "${dir}"
      return 0
    fi
    dir="$(dirname -- "${dir}")"
  done
  log_die "no ancestor of ${SCRIPT_DIR} holds both Makefile and cms — run this from a CMS checkout"
}

# Loads the checkout's .env; one absent or malformed is skipped, not fatal.
load_env_file() {
  local repo="$1"
  [[ -f "${repo}/.env" ]] || return 0
  set -a
  # shellcheck disable=SC1091
  source "${repo}/.env" 2>/dev/null || true
  set +a
}

# The served fullchain under <store>, or nothing when none is present.
cert_fullchain_path() {
  local store="$1" lineage="$2"
  if [[ -n "${lineage}" && -f "${store}/live/${lineage}/fullchain.pem" ]]; then
    printf '%s' "${store}/live/${lineage}/fullchain.pem"
  elif [[ -f "${store}/live/fullchain.pem" ]]; then
    printf '%s' "${store}/live/fullchain.pem"
  fi
  return 0
}

# Reads a field from a certificate: <cert> <openssl selector...>. The value on the right of
# the selector's "=" is what the operator sees, so the label is stripped either way.
cert_field() {
  local cert="$1"
  shift
  openssl x509 -noout "$@" -in "${cert}" 2>/dev/null | sed 's/^[^=]*=//' || true
}

# Whole days of validity left for an OpenSSL notAfter string; -1 when unreadable.
cert_days_left() {
  local expiry="$1" expiry_epoch now_epoch
  [[ -n "${expiry}" ]] || { printf '%s' "-1"; return 0; }
  expiry_epoch="$(date -d "${expiry}" +%s 2>/dev/null || date -j -f "%b %d %H:%M:%S %Y %Z" "${expiry}" +%s 2>/dev/null || echo 0)"
  now_epoch="$(date +%s)"
  if (( expiry_epoch <= 0 )); then
    printf '%s' "-1"
    return 0
  fi
  printf '%s' "$(( (expiry_epoch - now_epoch) / 86400 ))"
}

near_expiry() {
  local days="$1" renew_before="$2"
  (( days >= 0 )) && (( days <= renew_before ))
}

# Whether this host may and can post: the operator's switch, a webhook, openssl and python3.
can_send_alert() {
  if [[ "${CERT_NOTIFY_ENABLED:-1}" == "0" ]]; then
    log_info "certificate notifications disabled (CERT_NOTIFY_ENABLED=0)"
    return 1
  fi
  if [[ -z "${DISCORD_WEBHOOK_URL:-}" ]]; then
    log_info "no Discord webhook configured — certificate notification skipped"
    return 1
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    log_warn "openssl not found — cannot read the certificate"
    return 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    log_warn "python3 not found — cannot build the certificate notification"
    return 1
  fi
  return 0
}

# Reads one "<key>=<value>" line from the state file; empty when absent.
state_get() {
  local state_file="$1" key="$2"
  [[ -f "${state_file}" ]] || { printf ''; return 0; }
  awk -F= -v k="${key}" '$1==k { v=$0; sub(/^[^=]*=/,"",v); print v; exit }' "${state_file}" 2>/dev/null || true
}

# Persists what the last run saw. A store the operator cannot write is warned about, not fatal.
state_put() {
  local state_file="$1" fingerprint="$2" warned_for="$3"
  printf '%s=%s\n%s=%s\n' \
    "${STATE_KEY_FINGERPRINT}" "${fingerprint}" \
    "${STATE_KEY_WARNED_FOR}" "${warned_for}" > "${state_file}" \
    || log_warn "could not write the notification state file: ${state_file}"
}

# Prints the alert the observation calls for: renewed, expiring, or none.
decide_kind() {
  local prev_fp="$1" warned_for="$2" fingerprint="$3" expiry="$4" days="$5" renew_before="$6"
  # A first observation has no baseline, so it is never a renewal; a certificate already in
  # the renewal window still warrants one expiry warning.
  if [[ -n "${prev_fp}" ]] && [[ "${fingerprint}" != "${prev_fp}" ]]; then
    printf 'renewed'
    return 0
  fi
  if near_expiry "${days}" "${renew_before}" && [[ "${warned_for}" != "${expiry}" ]]; then
    printf 'expiring'
    return 0
  fi
  printf 'none'
}

# Persists the observation, keyed to the verdict it produced.
record_state() {
  local state_file="$1" fingerprint="$2" kind="$3" expiry="$4" warned_for="$5"
  [[ "${kind}" == "renewed" ]] && warned_for=""
  [[ "${kind}" == "expiring" ]] && warned_for="${expiry}"
  state_put "${state_file}" "${fingerprint}" "${warned_for}"
}

# Logs what the run decided; returns 1 when there is nothing to send.
announce_kind() {
  case "$1" in
    renewed)  log_info "certificate changed — announcing the renewal"; return 0 ;;
    expiring) log_info "certificate expiring in $2 day(s) — announcing"; return 0 ;;
    *)        log_info "certificate observed ($2 day(s) left) — no alert"; return 1 ;;
  esac
}

# Builds the Discord embed on stdout. Values arrive on stdin, one per line, so nothing that
# names the host is placed in argv: kind, host, domain, issuer, expiry, days_left.
notify_payload_json() {
  python3 -c '
import json, sys
parts = sys.stdin.read().split("\n")
kind, host, domain, issuer, expiry, days = (parts + [""] * 6)[:6]
if kind == "renewed":
    title = "\U0001F512 SSL certificate renewed"
    color = 65280
    description = "A new certificate was issued on %s." % host
else:
    title = "\u26A0 SSL certificate expiring"
    color = 16776960
    description = "The certificate on %s expires in %s day(s)." % (host, days)
fields = []
if domain:
    fields.append({"name": "Domain", "value": domain, "inline": True})
if issuer:
    fields.append({"name": "Issuer", "value": issuer, "inline": False})
if expiry:
    fields.append({"name": "Expires", "value": expiry, "inline": True})
print(json.dumps({"embeds": [{"title": title, "description": description, "color": color, "fields": fields}]}))
'
}

# The webhook token and the body stay out of argv: the token sits in a curl config file, the
# body in a 0600 temp file read with -d @file.
discord_post() {
  local webhook="$1" payload_file="$2" conf_file="$3"
  cat > "${conf_file}" <<EOF
url = "${webhook}"
EOF
  curl -s -o /dev/null -X POST -H "Content-Type: application/json" \
    -d "@${payload_file}" -K "${conf_file}" 2>/dev/null
}

# Posts one alert and always returns 0: a Discord outage must not mark the renewal failed.
send_alert() {
  local webhook="$1" kind="$2" host="$3" domain="$4" issuer="$5" expiry="$6" days="$7"
  local payload_file conf_file build_status=0

  payload_file="$(mktemp "${TMPDIR:-/tmp}/cms-cert-notify-payload.XXXXXX")" \
    || { log_warn "could not stage the certificate notification payload"; return 0; }
  chmod 600 "${payload_file}" 2>/dev/null || true
  conf_file="$(mktemp "${TMPDIR:-/tmp}/cms-cert-notify-request.XXXXXX")" \
    || { rm -f -- "${payload_file}"; log_warn "could not stage the certificate notification request"; return 0; }
  chmod 600 "${conf_file}" 2>/dev/null || true

  printf '%s\n%s\n%s\n%s\n%s\n%s\n' \
    "${kind}" "${host}" "${domain}" "${issuer}" "${expiry}" "${days}" \
    | notify_payload_json > "${payload_file}" || build_status=$?
  if (( build_status != 0 )); then
    log_warn "the certificate notification payload could not be built"
  else
    discord_post "${webhook}" "${payload_file}" "${conf_file}" \
      || log_warn "the Discord webhook POST failed"
  fi
  rm -f -- "${payload_file}" "${conf_file}"
}

main() {
  local repo store lineage cert host webhook state_file kind
  local fingerprint expiry issuer days prev_fp warned_for renew_before

  repo="$(repo_root)"
  load_env_file "${repo}"

  can_send_alert || return 0
  webhook="${DISCORD_WEBHOOK_URL}"

  store="${repo}/${CERT_STORE_REL}"
  lineage="${CERT_LINEAGE_DOMAIN:-${DOMAIN_NAME:-}}"
  cert="$(cert_fullchain_path "${store}" "${lineage}")"
  if [[ -z "${cert}" ]]; then
    log_info "no certificate found under ${store} — nothing to announce"
    return 0
  fi

  fingerprint="$(cert_field "${cert}" -fingerprint -sha256)"
  expiry="$(cert_field "${cert}" -enddate)"
  issuer="$(cert_field "${cert}" -issuer)"
  days="$(cert_days_left "${expiry}")"
  host="$(hostname 2>/dev/null || printf 'unknown')"
  renew_before="${ACME_RENEW_BEFORE_DAYS:-${DEFAULT_RENEW_BEFORE_DAYS}}"
  state_file="${store}/${NOTIFY_STATE_NAME}"
  prev_fp="$(state_get "${state_file}" "${STATE_KEY_FINGERPRINT}")"
  warned_for="$(state_get "${state_file}" "${STATE_KEY_WARNED_FOR}")"

  kind="$(decide_kind "${prev_fp}" "${warned_for}" "${fingerprint}" "${expiry}" "${days}" "${renew_before}")"
  record_state "${state_file}" "${fingerprint}" "${kind}" "${expiry}" "${warned_for}"
  announce_kind "${kind}" "${days}" || return 0
  send_alert "${webhook}" "${kind}" "${host}" "${lineage:-${DOMAIN_NAME:-}}" "${issuer}" "${expiry}" "${days}"
  return 0
}

main "$@"
