#!/usr/bin/env bash
# The state the feature request was raised against: a certificate that nothing will renew
# while the renewal line reads healthy. Cases build a real certificate with openssl, so
# expiry is a fact rather than a stub.
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

# The shared sandbox plus a docker stub that answers the proxy query with a running
# container, so a handover has something to stop, and records every other call.
sandbox() {
  local dir
  dir="$(domain_sandbox)"
  cat > "${dir}/bin/docker" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in
  ps) printf '%s\n' 'grader-nginx-proxy' ;;
  *) printf '%s %s\n' "${1:-}" "${2:-}" >> "${DOCKER_LOG}" ;;
esac
exit 0
STUB
  printf '#!/bin/bash\nexit 0\n' > "${dir}/bin/certbot"
  printf '#!/bin/bash\nexit 0\n' > "${dir}/bin/systemctl"
  chmod +x "${dir}/bin"/*
  printf '%s' "${dir}"
}

# Puts a real, live certificate in the lineage the proxy reads. `days` decides whether it
# counts as due, and `kind=lego` also plants lego's own artefact so the lineage reads as
# lego-owned rather than merely unmanaged.
install_cert() {
  local dir="$1" days="$2" kind="${3:-plain}"
  local dest="${dir}/config/letsencrypt/live/example.org"
  mkdir -p "$dest"
  openssl req -x509 -nodes -days "$days" -newkey rsa:2048 \
    -keyout "${dest}/privkey.pem" -out "${dest}/fullchain.pem" \
    -subj "/CN=example.org" 2>/dev/null
  chmod 600 "${dest}/privkey.pem"
  if [[ "$kind" == "lego" ]]; then
    mkdir -p "${dir}/config/letsencrypt/lego/certificates"
    printf 'LEGO\n' > "${dir}/config/letsencrypt/lego/certificates/example.org.crt"
    printf 'LEGO KEY\n' > "${dir}/config/letsencrypt/lego/certificates/example.org.key"
  fi
}

# The docker stub's record for one sandbox. Kept beside the directory rather than read
# from $DOCKER_LOG, which the script's own environment sets only inside a subshell.
docker_log() {
  cat "${1}/docker.log" 2>/dev/null
}

run_domain() {
  local dir="$1"
  shift
  export DOCKER_LOG="${dir}/docker.log"
  : > "$DOCKER_LOG"
  PATH="${dir}/bin:${PATH}" bash "${dir}/scripts/__domain.sh" "$@" \
    --domain example.org --email ops@example.org 2>&1
}

echo "an imported certificate is reported instead of being called healthy"
dir="$(sandbox)"
install_cert "$dir" 30
printf 'DOMAIN_CERT_METHOD=provided\n' > "${dir}/.env"
out="$(run_domain "$dir" status)"
if grep -qF -- "no certbot renewal config for example.org — certbot will never renew this certificate" <<<"$out"; then
  ok "status says nothing will renew it"
else
  no "status says nothing will renew it"
fi
if grep -qF -- "re-import: ./cms domain setup --cert provided" <<<"$out"; then
  ok "status prints the procedure that would replace it"
else
  no "status prints the procedure that would replace it"
fi
if grep -qE 'day\(s\) left\)' <<<"$out"; then
  ok "status prints how long there is left"
else
  no "status prints how long there is left"
fi

echo "status does not credit a timer for a certificate it ignores"
dir="$(sandbox)"
install_cert "$dir" 30
cat > "${dir}/bin/docker" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in
  ps) printf '%s\n' 'grader-certbot' ;;
  *) printf '%s %s\n' "${1:-}" "${2:-}" >> "${DOCKER_LOG}" ;;
esac
exit 0
STUB
chmod +x "${dir}/bin/docker"
out="$(run_domain "$dir" status)"
if grep -qF -- "Renewal timer: certbot container is running" <<<"$out"; then
  no "a running certbot container is not credited for an unmanaged certificate"
else
  ok "a running certbot container is not credited for an unmanaged certificate"
fi
if grep -qF -- "no certbot renewal config" <<<"$out"; then
  ok "the unmanaged certificate is still reported"
else
  no "the unmanaged certificate is still reported"
fi

echo "a lego certificate reports its window rather than a generic timer"
dir="$(sandbox)"
install_cert "$dir" 30 lego
out="$(run_domain "$dir" status)"
if grep -qF -- "Renewal: automatic — lego handover at 03:00 UTC" <<<"$out"; then
  ok "status names the configured handover hour"
else
  no "status names the configured handover hour"
fi
out="$(run_domain "$dir" status --json)"
if grep -qF -- '"renewal":"lego"' <<<"$out" && grep -qF -- '"renewal_managed":true' <<<"$out"; then
  ok "json reports a lego lineage as managed"
else
  no "json reports a lego lineage as managed (got: $out)"
fi

echo "a lego certificate says who will evaluate the window"
dir="$(sandbox)"
install_cert "$dir" 30 lego
out="$(run_domain "$dir" status)"
if grep -qF -- "Renewal timer: none installed" <<<"$out"; then
  ok "a lego certificate with nothing scheduled says so"
else
  no "a lego certificate with nothing scheduled says so (got: $out)"
fi
if grep -qF -- "./cms domain setup --install-timer" <<<"$out"; then
  ok "the absent timer names the command that installs one"
else
  no "the absent timer names the command that installs one (got: $out)"
fi
if grep -qF -- "Renewal timer: grader-cert-renew.timer is enabled" <<<"$out"; then
  no "an unscheduled window is not credited with a timer"
else
  ok "an unscheduled window is not credited with a timer"
fi

echo "a lego certificate names the timer that will evaluate the window"
dir="$(sandbox)"
install_cert "$dir" 30 lego
cat > "${dir}/bin/systemctl" <<'STUB'
#!/usr/bin/env bash
case "${2:-}" in
  grader-cert-renew.timer) printf 'enabled\n' ;;
esac
exit 0
STUB
chmod +x "${dir}/bin/systemctl"
out="$(run_domain "$dir" status)"
if grep -qF -- "Renewal timer: grader-cert-renew.timer is enabled" <<<"$out"; then
  ok "an installed timer is named"
else
  no "an installed timer is named (got: $out)"
fi
if grep -qF -- "Renewal timer: none installed" <<<"$out"; then
  no "an installed timer is not also reported as missing"
else
  ok "an installed timer is not also reported as missing"
fi

echo "a timer installed in the user manager is still found"
# The stub above answers on ${2} and exits 0 whatever it is asked, so it reports the
# same answer for both managers and cannot tell this case apart. This one models what
# systemd actually does: the system manager cannot see a user unit at all. Probed on a
# real enabled user timer — `systemctl --user is-enabled` printed "enabled" while the
# bare form printed "not-found" with exit 4 — so a check that asks only the system
# manager reports an installed timer as absent, which is the one answer this line must
# never give.
dir="$(sandbox)"
install_cert "$dir" 30 lego
cat > "${dir}/bin/systemctl" <<'STUB'
#!/usr/bin/env bash
# WHY the branch on $1: this repo's units are installed with `systemctl --user enable`,
# so only the user manager knows about them.
if [[ "${1:-}" == "--user" && "${2:-}" == "is-enabled" ]]; then
  case "${3:-}" in
    grader-cert-renew.timer) printf 'enabled\n'; exit 0 ;;
  esac
  printf 'not-found\n'
  exit 4
fi
printf 'not-found\n'
exit 4
STUB
chmod +x "${dir}/bin/systemctl"
out="$(run_domain "$dir" status)"
if grep -qF -- "Renewal timer: grader-cert-renew.timer is enabled" <<<"$out"; then
  ok "a user-manager timer is detected, not reported missing"
else
  no "a user-manager timer is detected, not reported missing (got: $out)"
fi

echo "json reports an unmanaged certificate as not managed"
dir="$(sandbox)"
install_cert "$dir" 30
out="$(run_domain "$dir" status --json)"
if grep -qF -- '"renewal":"external"' <<<"$out" && grep -qF -- '"renewal_managed":false' <<<"$out"; then
  ok "json reports an externally managed lineage as unmanaged"
else
  no "json reports an externally managed lineage as unmanaged (got: $out)"
fi

echo "the scheduled path stays quiet while there is no urgency"
dir="$(sandbox)"
install_cert "$dir" 30
out="$(run_domain "$dir" renew --due --apply)"
status=$?
if [[ "$status" -eq 0 ]] && grep -qF -- "nothing due" <<<"$out"; then
  ok "a scheduled run of an unmanaged certificate with time left exits quietly"
else
  no "a scheduled run of an unmanaged certificate with time left exits quietly (status $status)"
fi
if docker_log "$dir" | grep -qE '^(stop|start)'; then
  no "nothing is issued"
else
  ok "nothing is issued"
fi

echo "the scheduled path shouts when the margin is reached"
dir="$(sandbox)"
install_cert "$dir" 5
out="$(run_domain "$dir" renew --due --apply)"
if [[ "$?" -eq 0 ]] && grep -qF -- "no certbot renewal config" <<<"$out"; then
  ok "a due, unmanaged certificate is reported at its margin"
else
  no "a due, unmanaged certificate is reported at its margin"
fi

echo "an explicit renew fails rather than claiming success"
dir="$(sandbox)"
install_cert "$dir" 30
out="$(run_domain "$dir" renew --apply)"
if [[ "$?" -ne 0 ]] && grep -qF -- "no certbot renewal config, so certbot has no record of it" <<<"$out"; then
  ok "renew refuses instead of reporting a renewal that did not happen"
else
  no "renew refuses instead of reporting a renewal that did not happen"
fi
if grep -qF -- "Renewal complete" <<<"$out"; then
  no "no success is announced"
else
  ok "no success is announced"
fi

echo "the handover window needs both the margin and the hour"
dir="$(sandbox)"
install_cert "$dir" 5
printf 'ACME_RENEW_AT_UTC=\n' > "${dir}/.env"
out="$(run_domain "$dir" renew --due --apply --challenge tls-alpn-01 --acme-client lego)"
if grep -qF -- "tls-alpn-01 renewal not due" <<<"$out"; then
  ok "an empty window never opens"
else
  no "an empty window never opens (got: $out)"
fi
if docker_log "$dir" | grep -qE '^(stop|start)'; then
  no "the proxy is left alone outside the window"
else
  ok "the proxy is left alone outside the window"
fi

dir="$(sandbox)"
install_cert "$dir" 30
printf 'ACME_RENEW_AT_UTC=00:00\n' > "${dir}/.env"
out="$(run_domain "$dir" renew --due --apply --challenge tls-alpn-01 --acme-client lego)"
if grep -qF -- "tls-alpn-01 renewal not due" <<<"$out"; then
  ok "a certificate outside the margin waits even inside the hour"
else
  no "a certificate outside the margin waits even inside the hour (got: $out)"
fi

dir="$(sandbox)"
install_cert "$dir" 5 lego
printf 'ACME_RENEW_AT_UTC=00:00\nACME_HANDOVER_TIMEOUT=0\n' > "${dir}/.env"
out="$(run_domain "$dir" renew --due --apply --challenge tls-alpn-01 --acme-client lego)"
if docker_log "$dir" | grep -qE '^stop' && grep -qF -- "Renewal complete" <<<"$out"; then
  ok "inside both conditions the handover runs"
else
  no "inside both conditions the handover runs (got: $out)"
fi

echo "a malformed window is refused by name"
dir="$(sandbox)"
install_cert "$dir" 30
printf 'ACME_RENEW_AT_UTC=25:99\n' > "${dir}/.env"
out="$(run_domain "$dir" renew --due --apply --challenge tls-alpn-01 --acme-client lego)"
if grep -qF -- "ACME_RENEW_AT_UTC must be HH:MM" <<<"$out"; then
  ok "a window that is not a time says so"
else
  no "a window that is not a time says so (got: $out)"
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
(( fail == 0 ))
