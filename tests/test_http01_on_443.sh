#!/usr/bin/env bash
# Proves the optional shape: a host whose port 80 only redirects still validates, by
# moving the challenge to :443 and having :80 send everything there.
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

# The shared sandbox plus the nginx template, which is not sourced and so must be copied.
sandbox() {
  local dir
  dir="$(domain_sandbox)"
  cp "${REPO_ROOT}/config/grader.nginx.conf.template" "${dir}/config/"
  printf '#!/bin/bash\nexit 0\n' > "${dir}/bin/certbot"
  printf '#!/bin/bash\nexit 0\n' > "${dir}/bin/docker"
  chmod +x "${dir}/bin"/*
  printf '%s' "${dir}"
}

# Renders the proxy config for all four vhosts. selfsigned keeps the run off the network
# and off a CA, so only the render is under test.
render() {
  local dir="$1"
  shift
  printf '%s' "$dir"
  env -i PATH="$PATH" HOME="$HOME" "$@" bash "${dir}/scripts/__domain.sh" setup --apply \
    --cert selfsigned --email ops@example.org \
    --domain example.org --admin-domain admin.example.org \
    --oj-domain oj.example.org --ranking-domain ranking.example.org >/dev/null 2>&1
}

# The two halves of the file, split where TLS begins: the first port-80 vhost ends at the
# first `listen 443`, and everything after it is an HTTPS vhost.
before_tls() { sed -n '1,/listen 443/p' "$1"; }
after_tls() { sed -n '/listen 443/,$p' "$1"; }

count_in() { grep -cF -- "$2" <<<"$1"; }

echo "the default shape answers HTTP-01 on port 80"
dir="$(render "$(sandbox)")"
conf="${dir}/config/grader.nginx.conf"
if [[ -f "$conf" ]]; then
  ok "the proxy config was rendered"
else
  no "the proxy config was rendered"
  printf '\n%s passed, %s failed\n' "$pass" "$fail"
  exit 1
fi
before="$(before_tls "$conf")"
after="$(after_tls "$conf")"
if [[ "$(count_in "$before" "location /.well-known/acme-challenge/")" -eq 1 ]]; then
  ok "port 80 carries the challenge location"
else
  no "port 80 carries the challenge location"
fi
if [[ "$(count_in "$after" "location /.well-known/acme-challenge/")" -eq 0 ]]; then
  ok "no HTTPS vhost carries it yet"
else
  no "no HTTPS vhost carries it yet"
fi

echo "with ACME_HTTP01_ON_443 the challenge moves and :80 redirects everything"
dir="$(render "$(sandbox)" "ACME_HTTP01_ON_443=1")"
conf="${dir}/config/grader.nginx.conf"
before="$(before_tls "$conf")"
after="$(after_tls "$conf")"
if [[ "$(count_in "$before" "location /.well-known/acme-challenge/")" -eq 0 ]]; then
  ok "port 80 no longer answers the challenge itself"
else
  no "port 80 no longer answers the challenge itself"
fi
if [[ "$(count_in "$before" "return 301 https://\$host\$request_uri")" -ge 1 ]]; then
  ok "port 80 still redirects, which is what carries the redirect"
else
  no "port 80 still redirects, which is what carries the redirect"
fi
vhosts="$(count_in "$after" "listen 443")"
challenges="$(count_in "$after" "location /.well-known/acme-challenge/")"
if [[ "$challenges" -eq "$vhosts" && "$challenges" -ge 4 ]]; then
  ok "every HTTPS vhost answers the challenge ($challenges of $vhosts)"
else
  no "every HTTPS vhost answers the challenge ($challenges of $vhosts)"
fi

echo "neither shape leaves an unrendered placeholder behind"
# Comment lines are skipped: the template's own header documents ${VAR} as a literal, so
# reading it would report every shape as broken.
for mode in "" "ACME_HTTP01_ON_443=1"; do
  dir="$(render "$(sandbox)" $mode)"
  leftover="$(grep -vE '^[[:space:]]*#' "${dir}/config/grader.nginx.conf" \
    | grep -oE '\$\{[A-Z_][A-Z0-9_]*\}' | LC_ALL=C sort -u | tr '\n' ' ')"
  if [[ -z "$leftover" ]]; then
    ok "rendered with '${mode:-defaults}' leaves no \${VAR} behind"
  else
    no "rendered with '${mode:-defaults}' leaves no \${VAR} behind (left: $leftover)"
  fi
done

printf '\n%s passed, %s failed\n' "$pass" "$fail"
(( fail == 0 ))
