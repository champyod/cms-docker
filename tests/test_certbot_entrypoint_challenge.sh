#!/usr/bin/env bash
# Runs the certbot container's own decision block: it picks the challenge and the CA
# without the host script, and the case that must never touch certbot is provable only by
# running that block rather than starting a container.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
COMPOSE="${REPO_ROOT}/docker-compose.domain.yml"
ACME_LIB="${REPO_ROOT}/scripts/__acme.sh"

pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

# Everything the entrypoint does before it first acts: assignments and two function
# definitions, ending immediately before the first `if [ -z "$LINEAGE" ]` branch.
decision_prefix() {
  local entrypoint body
  entrypoint="$(awk '
    /^  certbot:/ { svc = 1 }
    svc && /^    entrypoint: >/ { ep = 1; next }
    ep && /^      / { print; next }
    ep { exit }
  ' "$COMPOSE" | sed -e 's/^      //' | tr '\n' ' ' | sed 's/\$\$/\$/g')"
  body="${entrypoint#*sh -c }"
  [[ "$body" == \'* ]] && body="${body:1}"
  printf '%s' "$body" | sed 's/if \[ -z "\$LINEAGE" \].*$//'
}

PREFIX="$(decision_prefix)"
if [[ -n "$PREFIX" ]] && grep -qF -- 'MODE=' <<<"$PREFIX"; then
  ok "entrypoint decision prefix extracted"
else
  no "entrypoint decision prefix extracted"
  printf '\n%s passed, %s failed\n' "$pass" "$fail"
  exit 1
fi

# Runs the prefix in a cleared environment so an unset key really is unset.
decide() {
  env -i PATH="$PATH" "$@" sh -c "${PREFIX}"'printf "MODE=%s|CHALLENGE=%s|SERVER=%s\n" "$MODE" "$CHALLENGE" "$SERVER"'
}

expect_field() {
  local description="$1" output="$2" field="$3" wanted="$4"
  local got
  got="$(printf '%s\n' "$output" | tr '|' '\n' | sed -n "s/^${field}=//p")"
  if [[ "$got" == "$wanted" ]]; then
    ok "$description"
  else
    no "$description (want $wanted, got $got)"
  fi
}

echo "an unset challenge keeps the behaviour the stack shipped with"
out="$(decide)"
expect_field "unset means http-01" "$out" "MODE" "http-01"
expect_field "unset means the webroot" "$out" "CHALLENGE" "--webroot -w /var/www/certbot"
expect_field "unset means certbot's own CA" "$out" "SERVER" ""

echo "tls-alpn-01 is refused to certbot rather than attempted by it"
out="$(decide ACME_CHALLENGE=tls-alpn-01)"
expect_field "tls-alpn-01 selects the host-driven mode" "$out" "MODE" "external"

echo "dns-01 needs its provider, and says so when it has none"
out="$(decide ACME_CHALLENGE=dns-01 ACME_DNS_PROVIDER=cloudflare)"
expect_field "dns-01 with a provider selects dns-01" "$out" "MODE" "dns-01"
expect_field "dns-01 builds the plugin flags" "$out" "CHALLENGE" \
  "--dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini"
out="$(decide ACME_CHALLENGE=dns-01)"
expect_field "dns-01 without a provider is an error, not a silent webroot" "$out" "MODE" "dns-01-error"

echo "the certificate authority decides the directory"
out="$(decide ACME_CA=zerossl)"
expect_field "zerossl selects its directory" "$out" "SERVER" \
  "--server https://acme.zerossl.com/v2/DV90"
out="$(decide ACME_CA=buypass)"
expect_field "buypass selects its directory" "$out" "SERVER" \
  "--server https://api.buypass.com/acme/directory"
out="$(decide ACME_CA=letsencrypt-staging)"
expect_field "the staging CA selects its directory" "$out" "SERVER" \
  "--server https://acme-staging-v02.api.letsencrypt.org/directory"
out="$(decide LE_STAGING=1)"
expect_field "LE_STAGING is an alias for the staging CA" "$out" "SERVER" \
  "--server https://acme-staging-v02.api.letsencrypt.org/directory"
out="$(decide ACME_CA=zerossl ACME_DIRECTORY_URL=https://custom.example/directory)"
expect_field "an explicit URL wins over the named CA" "$out" "SERVER" \
  "--server https://custom.example/directory"

echo "the two places that name a directory cannot drift apart"
script_urls="$(grep -oE 'readonly ACME_DIRECTORY_[A-Z_]+="https://[^"]+"' "$ACME_LIB" \
  | grep -oE 'https://[^"]+' | grep -v 'acme-v02' | LC_ALL=C sort -u)"
compose_urls="$(grep -oE 'SERVER="--server https://[^"]+"' "$COMPOSE" \
  | grep -oE 'https://[^"]+' | LC_ALL=C sort -u)"
if [[ -n "$script_urls" && "$script_urls" == "$compose_urls" ]]; then
  ok "scripts/__acme.sh and the entrypoint name the same directories"
else
  no "scripts/__acme.sh and the entrypoint name the same directories"
  printf '     script: %s\n' "$(echo "$script_urls" | tr '\n' ' ')"
  printf '     compose: %s\n' "$(echo "$compose_urls" | tr '\n' ' ')"
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
(( fail == 0 ))
