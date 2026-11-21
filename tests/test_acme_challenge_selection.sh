#!/usr/bin/env bash
# Drives the real __domain.sh so the challenge, client and CA decisions are read from its
# parser; every case is a dry run, so nothing is issued and no network is used.
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

# The shared sandbox plus stub clients, so a case that reaches issuance still resolves.
sandbox() {
  local dir
  dir="$(domain_sandbox)"
  printf '#!/bin/bash\nexit 0\n' > "${dir}/bin/certbot"
  printf '#!/bin/bash\nexit 0\n' > "${dir}/bin/docker"
  chmod +x "${dir}/bin"/*
  printf '%s' "${dir}"
}

# Writes values into the sandbox .env, which __domain.sh sources before its defaults —
# this is how a configured value is distinguished from a flag the operator typed.
sandbox_env() {
  local dir="$1"
  shift
  printf '%s\n' "$@" > "${dir}/.env"
}

# setup --dry-run with the two arguments every case needs: letsencrypt refuses to run
# without an email, and it refuses earlier than the part under test.
run_setup() {
  local dir="$1"
  shift
  PATH="${dir}/bin:${PATH}" bash "${dir}/scripts/__domain.sh" setup --dry-run \
    --domain example.org --email ops@example.org "$@" 2>&1
}

expect() {
  local description="$1" output="$2" pattern="$3"
  if grep -qF -- "$pattern" <<<"$output"; then
    ok "$description"
  else
    no "$description (wanted: $pattern)"
  fi
}

echo "the default combination is what existed before these keys"
out="$(run_setup "$(sandbox)")"
expect "default is http-01 through certbot against Let's Encrypt" "$out" \
  "ACME: challenge=http-01 client=certbot ca=letsencrypt directory=client-default"

echo "a challenge and the client that answers it must agree"
out="$(run_setup "$(sandbox)" --challenge tls-alpn-01 --acme-client certbot)"
expect "certbot is refused for tls-alpn-01" "$out" "ACME_CHALLENGE=tls-alpn-01 needs ACME_CLIENT=lego"
out="$(run_setup "$(sandbox)" --challenge tls-alpn-01 --acme-client lego)"
expect "lego is accepted for tls-alpn-01" "$out" \
  "ACME: challenge=tls-alpn-01 client=lego ca=letsencrypt directory=client-default"

echo "dns-01 without a provider cannot issue"
out="$(run_setup "$(sandbox)" --challenge dns-01)"
expect "dns-01 is refused without ACME_DNS_PROVIDER" "$out" \
  "ACME_CHALLENGE=dns-01 also needs ACME_DNS_PROVIDER"
out="$(run_setup "$(sandbox)" --challenge dns-01 --dns cloudflare)"
expect "dns-01 is accepted with a provider" "$out" \
  "ACME: challenge=dns-01 client=certbot"

echo "a value outside the enums is refused by name"
out="$(run_setup "$(sandbox)" --challenge tls-alpn)"
expect "an unknown challenge names the key" "$out" "unknown ACME_CHALLENGE: tls-alpn"
out="$(run_setup "$(sandbox)" --ca exampleca)"
expect "an unknown CA names the key" "$out" "unknown ACME_CA: exampleca"
out="$(run_setup "$(sandbox)" --ca custom)"
expect "custom CA requires an explicit URL" "$out" "ACME_CA=custom also needs ACME_DIRECTORY_URL"

echo "the certificate authority decides the directory"
out="$(run_setup "$(sandbox)" --staging)"
expect "--staging resolves the staging directory" "$out" \
  "directory=https://acme-staging-v02.api.letsencrypt.org/directory"
out="$(run_setup "$(sandbox)" --ca zerossl)"
expect "zerossl resolves its directory" "$out" "directory=https://acme.zerossl.com/v2/DV90"
out="$(run_setup "$(sandbox)" --ca buypass)"
expect "buypass resolves its directory" "$out" "directory=https://api.buypass.com/acme/directory"
out="$(run_setup "$(sandbox)" --ca letsencrypt --acme-server https://custom.example/directory)"
expect "an explicit URL wins over the named CA" "$out" \
  "directory=https://custom.example/directory"

echo "config is the default source and a flag that changes it says so"
dir="$(sandbox)"
sandbox_env "$dir" "ACME_CHALLENGE=dns-01" "ACME_DNS_PROVIDER=cloudflare"
out="$(run_setup "$dir" --challenge http-01)"
expect "an overridden challenge is reported" "$out" \
  "--challenge overrides config (dns-01 -> http-01)"
out="$(run_setup "$dir")"
expect "the configured challenge is used untouched" "$out" \
  "ACME: challenge=dns-01 client=certbot"

dir="$(sandbox)"
sandbox_env "$dir" "DOMAIN_CERT_METHOD=provided"
out="$(run_setup "$dir" --cert selfsigned)"
expect "an overridden cert method is reported" "$out" \
  "--cert overrides config (provided -> selfsigned)"

echo "the ACME keys are not validated for a run that never asks a CA"
dir="$(sandbox)"
sandbox_env "$dir" "DOMAIN_CERT_METHOD=selfsigned" "ACME_CHALLENGE=nonsense"
out="$(run_setup "$dir")"
if grep -qF -- "unknown ACME_CHALLENGE" <<<"$out"; then
  no "selfsigned run ignores the challenge it will not use"
else
  ok "selfsigned run ignores the challenge it will not use"
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
(( fail == 0 ))
