#!/usr/bin/env bash
# Exercises the certbot entrypoint's is_retriable() straight out of the compose file.
# The pattern list has to match what certbot 2.x prints ("Type: dns", "no valid A
# records found"), so this pins every alternative as retriable or terminal.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
COMPOSE="${REPO_ROOT}/docker-compose.domain.yml"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

# Extract is_retriable() from the entrypoint's folded YAML scalar, unescaping $$ -> $.
fn="$(awk '
  /^    entrypoint: >/ { in_ep = 1; next }
  in_ep {
    if ($0 ~ /^      /) { print; next }
    in_ep = 0
  }
' "$COMPOSE" \
  | sed -e 's/^      //' \
  | awk '/^is_retriable\(\) \{$/ { keep = 1 } keep { print } /^\};$/ && keep { keep = 0 }' \
  | sed -e 's/\$\$/\$/g')"

if [[ -n "$fn" ]]; then
  ok "is_retriable() extracted from the certbot entrypoint"
else
  no "is_retriable() extracted from the certbot entrypoint"
  exit 1
fi

# shellcheck disable=SC1090
eval "$fn"

# Failures retrying can fix must return 0 so the loop backs off and retries.
retriable=(
  'urn:ietf:params:acme:error:dns: DNS problem'
  'Type: dns
no valid A records found for grader.example.org'
  'no valid A records found for grader.example.org'
  'Timeout during connect (30000ms)'
  'Connection refused'
  'Invalid response from http://grader.example.org/.well-known/acme-challenge/xyz'
  'urn:ietf:params:acme:error:connection'
  'urn:ietf:params:acme:error:rateLimited'
  'too many certificates already issued for: grader.example.org'
)
for out in "${retriable[@]}"; do
  label="${out%%$'\n'*}"
  if is_retriable "$out"; then
    ok "retriable: ${label}"
  else
    no "retriable: ${label}"
  fi
done

# Failures retrying cannot fix must return 1 so the loop stops.
terminal=(
  'urn:ietf:params:acme:error:unauthorized'
  'no such account'
  'CAA record for grader.example.org forbids issuance'
)
for out in "${terminal[@]}"; do
  if is_retriable "$out"; then
    no "terminal: ${out}"
  else
    ok "terminal: ${out}"
  fi
done

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
