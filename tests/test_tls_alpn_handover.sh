#!/usr/bin/env bash
# Proves the property the :443 handover exists for: whatever happens during the
# challenge, the proxy comes back. docker is stubbed, so ordering comes from a log.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DOMAIN="${REPO_ROOT}/scripts/__domain.sh"
# shellcheck source=__lib/domain_sandbox.sh
source "${SCRIPT_DIR}/__lib/domain_sandbox.sh"

pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

trap domain_sandbox_cleanup EXIT

# The shared sandbox plus a docker stub that records what it was asked to do and can be
# told to fail the lego run or to succeed without writing the certificate.
sandbox() {
  local dir
  dir="$(domain_sandbox)"
  printf '#!/bin/bash\nexit 0\n' > "${dir}/bin/certbot"
  cat > "${dir}/bin/docker" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in
  ps)
    [[ -f "${PROXY_ABSENT:-}" ]] && exit 0
    printf '%s\n' 'grader-nginx-proxy'
    ;;
  stop) printf 'stop %s\n' "${2:-}" >> "${DOCKER_LOG}" ;;
  start) printf 'start %s\n' "${2:-}" >> "${DOCKER_LOG}" ;;
  run)
    printf 'run %s\n' "$*" >> "${DOCKER_LOG}"
    [[ -f "${RUN_FAILS:-}" ]] && exit 1
    [[ -f "${RUN_NO_FILES:-}" ]] && exit 0
    host=""; name=""; previous=""
    for argument in "$@"; do
      [[ "$previous" == "-v" ]] && host="${argument%%:*}"
      [[ "$previous" == "--cert.name" ]] && name="$argument"
      previous="$argument"
    done
    if [[ -n "$host" && -n "$name" ]]; then
      mkdir -p "${host}/certificates"
      printf 'CERT\n' > "${host}/certificates/${name}.crt"
      printf 'KEY\n' > "${host}/certificates/${name}.key"
    fi
    ;;
esac
exit 0
STUB
  chmod +x "${dir}/bin"/*
  printf '%s' "${dir}"
}

# cert --apply with tls-alpn-01: issuance only, so the run touches nothing but the
# challenge. The log and the flags are per-sandbox, and every run waits on nothing.
run_cert() {
  local dir="$1"
  shift
  export DOCKER_LOG="${dir}/docker.log"
  export ACME_HANDOVER_TIMEOUT=0
  : > "$DOCKER_LOG"
  PATH="${dir}/bin:${PATH}" bash "${dir}/scripts/__domain.sh" cert --apply \
    --challenge tls-alpn-01 --acme-client lego \
    --domain example.org --email ops@example.org "$@" 2>&1
}

log_lines() {
  cat "${1}/docker.log" 2>/dev/null
}

echo "a failed issuance still gives :443 back"
dir="$(sandbox)"
: > "${dir}/fails"
export RUN_FAILS="${dir}/fails"
unset RUN_NO_FILES PROXY_ABSENT 2>/dev/null || true
out="$(run_cert "$dir")"; status=$?
unset RUN_FAILS 2>/dev/null || true
if [[ "$status" -ne 0 ]]; then
  ok "a failed lego run fails the command"
else
  no "a failed lego run fails the command"
fi
if grep -qF -- ":443 has been returned to the proxy" <<<"$out"; then
  ok "the failure says the proxy got :443 back"
else
  no "the failure says the proxy got :443 back"
fi
order="$(log_lines "$dir" | grep -E '^(stop|start|run)' | tr '\n' ' ')"
if [[ "$order" == stop*run*start* ]]; then
  ok "stop precedes the run and start follows it"
else
  no "stop precedes the run and start follows it (order: $order)"
fi

echo "a run that writes no certificate still gives :443 back"
dir="$(sandbox)"
: > "${dir}/nofiles"
export RUN_NO_FILES="${dir}/nofiles"
out="$(run_cert "$dir")"; status=$?
unset RUN_NO_FILES 2>/dev/null || true
if [[ "$status" -ne 0 ]] && grep -qF -- "lego reported success but" <<<"$out"; then
  ok "a missing certificate is reported rather than passed on"
else
  no "a missing certificate is reported rather than passed on"
fi
if log_lines "$dir" | grep -qx "start grader-nginx-proxy"; then
  ok "the proxy was restarted before the install was attempted"
else
  no "the proxy was restarted before the install was attempted"
fi

echo "a successful run installs into the lineage the proxy reads"
dir="$(sandbox)"
out="$(run_cert "$dir")"; status=$?
if [[ "$status" -eq 0 ]]; then
  ok "issuance succeeds"
else
  no "issuance succeeds (status $status)"
fi
dest="${dir}/config/letsencrypt/live/example.org"
if [[ -f "${dest}/fullchain.pem" && -f "${dest}/privkey.pem" ]]; then
  ok "the certificate lands in live/<lineage>/"
else
  no "the certificate lands in live/<lineage>/"
fi
if [[ "$(head -n1 "${dest}/fullchain.pem" 2>/dev/null)" == "CERT" ]] \
   && [[ "$(head -n1 "${dest}/privkey.pem" 2>/dev/null)" == "KEY" ]]; then
  ok "both files carry what lego produced"
else
  no "both files carry what lego produced"
fi
if [[ "$(stat -c %a "${dest}/privkey.pem" 2>/dev/null)" == "600" ]]; then
  ok "the private key is not readable by anyone else"
else
  no "the private key is not readable by anyone else"
fi
if log_lines "$dir" | grep -qE -- '--tls\.address :443'; then
  ok "lego is asked for the tls-alpn challenge on :443"
else
  no "lego is asked for the tls-alpn challenge on :443"
fi
if log_lines "$dir" | grep -qE -- ' -d example\.org( |$)'; then
  ok "the configured domain is a lego SAN"
else
  no "the configured domain is a lego SAN"
fi

echo "a box with no proxy running is not stopped and not started"
dir="$(sandbox)"
: > "${dir}/absent"
export PROXY_ABSENT="${dir}/absent"
out="$(run_cert "$dir")"; status=$?
unset PROXY_ABSENT 2>/dev/null || true
if [[ "$status" -eq 0 ]] && grep -qF -- "no domain proxy is running" <<<"$out"; then
  ok "an absent proxy is reported instead of assumed"
else
  no "an absent proxy is reported instead of assumed"
fi
if log_lines "$dir" | grep -qE '^(stop|start)'; then
  no "no container is stopped or started"
else
  ok "no container is stopped or started"
fi

echo "a dry run describes the handover without performing it"
dir="$(sandbox)"
export DOCKER_LOG="${dir}/docker.log"
export ACME_HANDOVER_TIMEOUT=0
: > "$DOCKER_LOG"
out="$(PATH="${dir}/bin:${PATH}" bash "${dir}/scripts/__domain.sh" cert \
  --challenge tls-alpn-01 --acme-client lego \
  --domain example.org --email ops@example.org 2>&1)"
if grep -qF -- "[dry-run] would stop grader-nginx-proxy" <<<"$out"; then
  ok "the preview names the container it would stop"
else
  no "the preview names the container it would stop"
fi
if [[ -s "$DOCKER_LOG" ]]; then
  no "a dry run issues nothing"
else
  ok "a dry run issues nothing"
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
(( fail == 0 ))
