#!/usr/bin/env bash
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
if [ -f "${SCRIPT_DIR}/__lib/common.sh" ]; then
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/__lib/common.sh"
fi
declare -F log_info >/dev/null 2>&1 || log_info() { printf '[INFO] %s\n' "$*"; }
declare -F log_warn >/dev/null 2>&1 || log_warn() { printf '[WARN] %s\n' "$*" >&2; }
declare -F log_die  >/dev/null 2>&1 || log_die()  { printf '[FAIL] %s\n' "${1:-fatal}" >&2; exit "${2:-1}"; }

findings=0
violations=0
tmp_findings=$(mktemp)
tmp_violations=$(mktemp)
trap 'rm -f "$tmp_findings" "$tmp_violations"' EXIT

SHLIB_DIR="${SCRIPT_DIR}/__lib"

for f in "${SCRIPT_DIR}"/*.sh; do
  [ -e "$f" ] || continue
  case "$f" in
    "${SHLIB_DIR}"/*) continue ;;
    "${SCRIPT_DIR}/__check_lib_contract.sh") continue ;;
  esac
  rel="${f#"${REPO_ROOT}/"}"

  if grep -nE '^[[:space:]]*(function[[:space:]]+)?log_(info|warn|die)[[:space:]]*\(\)' "$f" >/dev/null 2>&1; then
    while IFS= read -r line; do
      lineno="${line%%:*}"
      printf '%s:%s: duplicate log helper definition\n' "$rel" "$lineno" >> "$tmp_violations"
      violations=$((violations + 1))
    done < <(grep -nE '^[[:space:]]*(function[[:space:]]+)?log_(info|warn|die)[[:space:]]*\(\)' "$f" 2>/dev/null || true)
  fi

  if grep -nE '^[[:space:]]*(function[[:space:]]+)?die[[:space:]]*\(\)' "$f" >/dev/null 2>&1; then
    while IFS= read -r line; do
      lineno="${line%%:*}"
      printf '%s:%s: duplicate die() helper definition (use log_die from common.sh)\n' "$rel" "$lineno" >> "$tmp_violations"
      violations=$((violations + 1))
    done < <(grep -nE '^[[:space:]]*(function[[:space:]]+)?die[[:space:]]*\(\)' "$f" 2>/dev/null || true)
  fi

  if grep -nE 'declare[[:space:]]+-F[[:space:]]+log_' "$f" >/dev/null 2>&1; then
    while IFS= read -r line; do
      lineno="${line%%:*}"
      printf '%s:%s: declare -F log_ fallback block (source __lib/common.sh instead)\n' "$rel" "$lineno" >> "$tmp_violations"
      violations=$((violations + 1))
    done < <(grep -nE 'declare[[:space:]]+-F[[:space:]]+log_' "$f" 2>/dev/null || true)
  fi

  if grep -nE '^[[:space:]]*(function[[:space:]]+)?require_disk_free_gb[[:space:]]*\(\)' "$f" >/dev/null 2>&1; then
    while IFS= read -r line; do
      lineno="${line%%:*}"
      printf '%s:%s: duplicate require_disk_free_gb definition (use __lib/common.sh)\n' "$rel" "$lineno" >> "$tmp_violations"
      violations=$((violations + 1))
    done < <(grep -nE '^[[:space:]]*(function[[:space:]]+)?require_disk_free_gb[[:space:]]*\(\)' "$f" 2>/dev/null || true)
  fi

  if grep -nE 'source[[:space:]]+.*\.env' "$f" >/dev/null 2>&1; then
    while IFS= read -r line; do
      lineno="${line%%:*}"
      printf '%s:%s: finding — bare source .env (shared loader in __lib/common.sh is canonical)\n' "$rel" "$lineno" >> "$tmp_findings"
      findings=$((findings + 1))
    done < <(grep -nE 'source[[:space:]]+.*\.env' "$f" 2>/dev/null || true)
  fi

  if grep -nE 'docker exec[^|]*psql' "$f" >/dev/null 2>&1; then
    while IFS= read -r line; do
      lineno="${line%%:*}"
      printf '%s:%s: finding — raw docker exec psql (consider shared helper)\n' "$rel" "$lineno" >> "$tmp_findings"
      findings=$((findings + 1))
    done < <(grep -nE 'docker exec[^|]*psql' "$f" 2>/dev/null || true)
  fi
done

CMS_BIN="${REPO_ROOT}/cms"
if [ -f "$CMS_BIN" ]; then
  rel="cms"
  if grep -nE '^[[:space:]]*(function[[:space:]]+)?log_(info|warn|die)[[:space:]]*\(\)' "$CMS_BIN" >/dev/null 2>&1; then
    while IFS= read -r line; do
      lineno="${line%%:*}"
      printf '%s:%s: duplicate log helper definition\n' "$rel" "$lineno" >> "$tmp_violations"
      violations=$((violations + 1))
    done < <(grep -nE '^[[:space:]]*(function[[:space:]]+)?log_(info|warn|die)[[:space:]]*\(\)' "$CMS_BIN" 2>/dev/null || true)
  fi
fi

if [ -s "$tmp_findings" ]; then
  printf '[INFO] lib-contract findings (%d informational — not enforced):\n' "$findings" >&2
  cat "$tmp_findings" >&2
fi

if [ "$violations" -gt 0 ]; then
  printf '[FAIL] lib-contract FAILED: %d violation(s)\n' "$violations" >&2
  cat "$tmp_violations" >&2
  exit 1
fi

log_info "lib-contract OK"
