#!/usr/bin/env bash
# One key in two sections is one .env slot written twice: __pending is keyed by the bare
# key, so the later row silently wins and editing the other section does nothing.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE="${REPO_ROOT}/config.toml.example"
SPEC="${REPO_ROOT}/scripts/__update_engine.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

echo "no key is defined in two config sections"
duplicated="$(awk '
  /^\[/ { sec=$0; gsub(/[][]/, "", sec); next }
  /^[A-Za-z_][A-Za-z0-9_]*[ ]*=/ { key=$1; seen[key]=seen[key] " " sec; count[key]++ }
  END { for (k in count) if (count[k] > 1) print k seen[k] }
' "$EXAMPLE")"
if [[ -z "$duplicated" ]]; then
  ok "config.toml.example has no duplicated key"
else
  no "config.toml.example has no duplicated key"
  printf '%s\n' "$duplicated"
fi

echo "no key occupies two VAR_SPECS slots"
duplicated="$(grep -oE '"[^"|]+\|[a-z_]+\|[A-Z0-9_]+\|' "$SPEC" \
  | cut -d'|' -f3 | tr -d '"' | sort | uniq -d)"
if [[ -z "$duplicated" ]]; then
  ok "VAR_SPECS maps each key exactly once"
else
  no "VAR_SPECS maps each key exactly once"
  printf '%s\n' "$duplicated"
fi

echo "the families stay together"
check_single_section() {
  local pattern="$1" expect="$2" label="$3" sections
  sections="$(awk -v pat="$pattern" '
    /^\[/ { sec=$0; gsub(/[][]/, "", sec); next }
    $0 ~ pat { found[sec]=1 }
    END { for (s in found) printf "%s ", s }
  ' "$EXAMPLE")"
  if [[ "$sections" == "${expect} " ]]; then
    ok "${label} lives only in [${expect}]"
  else
    no "${label} lives only in [${expect}] (found: ${sections:-none})"
  fi
}

check_single_section '^WAF_[A-Z0-9_]* = ' infra 'WAF_*'
check_single_section '^MTLS_[A-Z0-9_]* = ' core 'MTLS_*'
check_single_section '^ACME_DNS_PROVIDER = ' admin 'ACME_DNS_PROVIDER'

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
