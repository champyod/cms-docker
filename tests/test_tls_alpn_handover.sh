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
# told to fail the lego run, to succeed without writing the certificate, or to refuse a stop.
sandbox() {
  local dir
  dir="$(domain_sandbox)"
  printf '#!/bin/bash\nexit 0\n' > "${dir}/bin/certbot"
  cat > "${dir}/bin/docker" <<'STUB'
#!/usr/bin/env bash
# The running containers, one "name|published ports" row per line, as DOCKER_PS_ROWS.
# A row without "|" is a container that publishes nothing. With no fixture at all the box
# runs only the proxy, which is the default this file used to assume.
docker_rows() {
  if [[ -f "${DOCKER_PS_ROWS:-}" ]]; then
    cat "${DOCKER_PS_ROWS}"
  elif [[ -f "${PROXY_ABSENT:-}" ]]; then
    return 0
  else
    printf 'grader-nginx-proxy|0.0.0.0:443->443/tcp, 0.0.0.0:80->80/tcp\n'
  fi
}
case "${1:-}" in
  ps)
    [[ "$(cat "${PS_FAILS:-}" 2>/dev/null)" == "yes" ]] && exit 1
    if [[ "${*}" == *'{{.Ports}}'* ]]; then
      docker_rows
    else
      docker_rows | cut -d'|' -f1
    fi
    ;;
  stop)
    printf 'stop %s\n' "${2:-}" >> "${DOCKER_LOG}"
    if [[ -n "${STOP_FAILS:-}" && "$(cat "${STOP_FAILS}")" == "${2:-}" ]]; then
      exit 1
    fi
    ;;
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

# The running containers the docker stub reports, as "name|published ports" rows.
ps_rows() {
  local dir="$1"
  shift
  printf '%s\n' "$@" > "${dir}/ps-rows"
  export DOCKER_PS_ROWS="${dir}/ps-rows"
}

# The handover functions on their own, for the guarantees the cert command cannot reach:
# a restore the trap and the normal path both make, and a stop the harness can refuse.
handover_only() {
  local dir="$1"
  shift
  export DOCKER_LOG="${dir}/docker.log"
  : > "$DOCKER_LOG"
  PATH="${dir}/bin:${PATH}" ACME_HANDOVER_TIMEOUT=0 bash -c '
    log_info() { :; }
    log_warn() { :; }
    log_die() { printf "DIE %s\n" "$1" >&2; exit "${2:-1}"; }
    source "'"${REPO_ROOT}"'/scripts/__acme_tls_alpn.sh"
    eval "$1"
  ' _ "$*" 2>&1
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

echo "a box with nothing publishing :443 stops and starts nothing"
dir="$(sandbox)"
: > "${dir}/empty"
printf 'grader-waf|127.0.0.1:8080->8080/tcp\n' > "${dir}/empty"
export DOCKER_PS_ROWS="${dir}/empty"
out="$(run_cert "$dir")"; status=$?
unset DOCKER_PS_ROWS 2>/dev/null || true
if [[ "$status" -eq 0 ]] && grep -qF -- ":443 is already free" <<<"$out"; then
  ok "a free :443 is reported instead of assumed"
else
  no "a free :443 is reported instead of assumed"
fi
if log_lines "$dir" | grep -qE '^(stop|start)'; then
  no "no holder is stopped or started"
else
  ok "no holder is stopped or started"
fi

echo "a WAF holding :443 is stopped and given back"
dir="$(sandbox)"
ps_rows "$dir" 'grader-nginx-proxy|0.0.0.0:8443->8443/tcp' \
  'grader-waf|0.0.0.0:443->8080/tcp, 127.0.0.1:8080->8080/tcp'
out="$(run_cert "$dir")"; status=$?
if [[ "$status" -eq 0 ]] && log_lines "$dir" | grep -qx "stop grader-waf"; then
  ok "the WAF on :443 is stopped for the challenge"
else
  no "the WAF on :443 is stopped for the challenge (status $status)"
fi
if log_lines "$dir" | grep -qx "start grader-waf"; then
  ok "the WAF is started again afterwards"
else
  no "the WAF is started again afterwards"
fi
if log_lines "$dir" | grep -qE '^(stop|start) grader-nginx-proxy$'; then
  no "the proxy, which never held :443, is left alone"
else
  ok "the proxy, which never held :443, is left alone"
fi

echo "every holder of :443 is stopped and every one is given back"
dir="$(sandbox)"
ps_rows "$dir" 'grader-nginx-proxy|0.0.0.0:443->443/tcp' \
  'grader-waf|[::]:443->8080/tcp, 127.0.0.1:8080->8080/tcp'
out="$(run_cert "$dir")"; status=$?
stopped="$(log_lines "$dir" | grep -c '^stop ')"
started="$(log_lines "$dir" | grep -c '^start ')"
if [[ "$stopped" -eq 2 && "$started" -eq 2 ]]; then
  ok "both holders are stopped and both are restarted"
else
  no "both holders are stopped and both are restarted (stopped $stopped, started $started)"
fi

echo "a holder is found through an IPv6 binding"
dir="$(sandbox)"
ps_rows "$dir" 'grader-waf|[::]:443->8080/tcp'
handover_only "$dir" 'acme_release_port443; acme_restore_port443'
if log_lines "$dir" | grep -qx "stop grader-waf"; then
  ok "an [::]:443 binding counts as holding :443"
else
  no "an [::]:443 binding counts as holding :443"
fi

echo "a holder is found through a ranged host binding"
dir="$(sandbox)"
ps_rows "$dir" 'grader-waf|0.0.0.0:440-450->8080/tcp'
handover_only "$dir" 'acme_release_port443; acme_restore_port443'
if log_lines "$dir" | grep -qx "stop grader-waf"; then
  ok "a 440-450 range counts as holding :443"
else
  no "a 440-450 range counts as holding :443"
fi

echo "a container holding :443 over UDP only is not touched"
dir="$(sandbox)"
ps_rows "$dir" 'grader-waf|0.0.0.0:443->8080/udp'
handover_only "$dir" 'acme_release_port443; acme_restore_port443'
if log_lines "$dir" | grep -qE '^(stop|start)'; then
  no "a UDP binding does not stop the challenge binding TCP :443"
else
  ok "a UDP binding does not stop the challenge binding TCP :443"
fi

echo "a container publishing only nearby ports is not touched"
dir="$(sandbox)"
ps_rows "$dir" 'grader-nginx-proxy|0.0.0.0:8443->8443/tcp, 0.0.0.0:80->80/tcp'
handover_only "$dir" 'acme_release_port443; acme_restore_port443'
if log_lines "$dir" | grep -qE '^(stop|start)'; then
  no "nothing is stopped when :443 is already free"
else
  ok "nothing is stopped when :443 is already free"
fi

echo "a stop the daemon refuses is loud and is never undone by a start"
dir="$(sandbox)"
ps_rows "$dir" 'grader-nginx-proxy|0.0.0.0:443->443/tcp'
: > "${dir}/stop-fails"
printf 'grader-nginx-proxy' > "${dir}/stop-fails"
export STOP_FAILS="${dir}/stop-fails"
out="$(handover_only "$dir" 'acme_release_port443; acme_restore_port443')"; status=$?
unset STOP_FAILS 2>/dev/null || true
if [[ "$status" -ne 0 ]] && grep -qF -- "could not stop grader-nginx-proxy" <<<"$out"; then
  ok "a refused stop fails the run instead of continuing"
else
  no "a refused stop fails the run instead of continuing (status $status, out: $out)"
fi
if log_lines "$dir" | grep -qx "start grader-nginx-proxy"; then
  no "a container that was never stopped is never started back"
else
  ok "a container that was never stopped is never started back"
fi

echo "a docker that cannot list containers fails the handover"
dir="$(sandbox)"
printf 'yes' > "${dir}/ps-fails"
export PS_FAILS="${dir}/ps-fails"
out="$(handover_only "$dir" 'acme_release_port443')"; status=$?
unset PS_FAILS 2>/dev/null || true
if [[ "$status" -ne 0 ]] && grep -qF -- "could not list the running containers" <<<"$out"; then
  ok "an unreadable container list is not read as a free :443"
else
  no "an unreadable container list is not read as a free :443 (status $status, out: $out)"
fi

echo "restoring twice starts nothing twice"
dir="$(sandbox)"
ps_rows "$dir" 'grader-nginx-proxy|0.0.0.0:443->443/tcp' \
  'grader-waf|0.0.0.0:443->8080/tcp'
handover_only "$dir" 'acme_release_port443; acme_restore_port443; acme_restore_port443'
starts="$(log_lines "$dir" | grep -c '^start ')"
if [[ "$starts" -eq 2 ]]; then
  ok "a second restore is a no-op"
else
  no "a second restore is a no-op (starts: $starts)"
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
