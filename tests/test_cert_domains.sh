#!/usr/bin/env bash
# tests/test_cert_domains.sh — pin which names build_cert_domains certifies.
#
# WHY the three functions are extracted and evaluated instead of running the script:
# __domain.sh is a host-side ceremony (run lock, certbot, docker exec) with no seam for
# calling a single function, so this test sources exactly the functions it exercises and
# stubs the one logger they call.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DOMAIN_SH="${REPO_ROOT}/scripts/__domain.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SANDBOXES=()
cleanup() { rm -rf "${SANDBOXES[@]+"${SANDBOXES[@]}"}"; }
trap cleanup EXIT

extract() { sed -n "/^$1()/,/^}/p" "$DOMAIN_SH"; }

log_die() { printf 'die: %s\n' "$*" >&2; return 1; }

setup() {
  SB="$(mktemp -d)"
  SANDBOXES+=("${SB}")
  mkdir -p "${SB}/config/generated"
  # The functions read REPO_ROOT, so the sandbox becomes the repo root for the test.
  REPO_ROOT="${SB}"
  DOMAIN_NAME="a.example.com"
  ADMIN_DOMAIN=""
  OJ_DOMAIN=""
  RANKING_DOMAIN=""
  EXTRA_DOMAINS=""
  eval "$(extract wired_tls_hostnames)"
  eval "$(extract _configured_domains)"
  eval "$(extract build_cert_domains)"
}

# The names only: CERT_DOMAINS interleaves -d with each name.
cert_names() {
  local entry
  for entry in "${CERT_DOMAINS[@]}"; do
    [[ "$entry" == "-d" ]] && continue
    printf '%s\n' "$entry"
  done | paste -sd' ' -
}

echo "=== Test 1: no registry file certifies only the configured domains ==="
setup
rm -f "${REPO_ROOT}/config/generated/exposed-hosts.txt"
build_cert_domains
[[ "$(cert_names)" == "a.example.com" ]] && ok "certifies the configured domain alone" \
  || no "unexpected names: $(cert_names)"

echo ""
echo "=== Test 2: a registry hostname joins the certificate ==="
setup
printf '%s\n' "b.example.com" > "${REPO_ROOT}/config/generated/exposed-hosts.txt"
build_cert_domains
[[ "$(cert_names)" == "a.example.com b.example.com" ]] && ok "adds the exposed hostname" \
  || no "unexpected names: $(cert_names)"

echo ""
echo "=== Test 3: a hostname already configured is not repeated ==="
setup
printf '%s\n' "a.example.com" > "${REPO_ROOT}/config/generated/exposed-hosts.txt"
build_cert_domains
[[ "$(cert_names)" == "a.example.com" ]] && ok "keeps one entry per name" \
  || no "unexpected names: $(cert_names)"

echo ""
echo "=== Test 4: a name that merely ends with another is still certified ==="
setup
printf '%s\n' "x-a.example.com" > "${REPO_ROOT}/config/generated/exposed-hosts.txt"
build_cert_domains
[[ "$(cert_names)" == "a.example.com x-a.example.com" ]] && ok "matches whole names, not suffixes" \
  || no "unexpected names: $(cert_names)"

echo ""
echo "=== Test 5: blank lines in the rendered file are ignored ==="
setup
printf '\n\nb.example.com\n\n' > "${REPO_ROOT}/config/generated/exposed-hosts.txt"
build_cert_domains
[[ "$(cert_names)" == "a.example.com b.example.com" ]] && ok "ignores blanks" \
  || no "unexpected names: $(cert_names)"

echo ""
printf 'cert-domains: %d passed, %d failed\n' "${pass}" "${fail}"
[[ ${fail} -eq 0 ]]
