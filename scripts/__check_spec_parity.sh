#!/usr/bin/env bash
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"
# WHY: every sort below runs under LC_ALL=C because the resulting sets are compared with comm —
# collation is machine-dependent, and a locale-ordered sort would report phantom differences.
EXAMPLE="${REPO_ROOT}/config.toml.example"
ENGINE="${REPO_ROOT}/scripts/__update_engine.sh"
[ -f "$EXAMPLE" ] || log_die "missing $EXAMPLE" 1
[ -f "$ENGINE" ] || log_die "missing $ENGINE" 1
tmp_ex=$(mktemp); tmp_sp=$(mktemp); tmp_sp_u=$(mktemp); tmp_dup=$(mktemp)
trap 'rm -f "$tmp_ex" "$tmp_sp" "$tmp_sp_u" "$tmp_dup"' EXIT
awk '{
  line=$0; sub(/^[ \t]+/,"",line)
  if (line ~ /^\[[^]]+\]/) {sec=line; sub(/[#;].*/,"",sec); gsub(/^[ \t]+|[ \t\r]+$/,"",sec); cur=sec; next}
  if (line ~ /^[A-Z0-9_]+[ \t]*=/) {k=$1; gsub(/[^A-Z0-9_]/,"",k); if(cur!="") print cur"|"k}
}' "$EXAMPLE" | LC_ALL=C sort -u > "$tmp_ex"
grep -E '"[^"]+\|\[[^]]+\]\|[A-Z0-9_]+\|' "$ENGINE" | awk -F'|' '{gsub(/"/,"",$2); gsub(/"/,"",$3); gsub(/^[ \t]+|[ \t]+$/,"",$2); gsub(/^[ \t]+|[ \t]+$/,"",$3); print $2"|"$3}' | LC_ALL=C sort > "$tmp_sp"
LC_ALL=C sort -u "$tmp_sp" > "$tmp_sp_u"
if LC_ALL=C sort "$tmp_sp" | uniq -d | grep -q .; then
  log_warn "duplicate VAR_SPEC entries (mirrors):"
  LC_ALL=C sort "$tmp_sp" | uniq -d | while IFS= read -r d; do log_warn "  dup $d"; done
fi
missing=$(comm -23 "$tmp_ex" "$tmp_sp_u" || true)
unknown=$(comm -13 "$tmp_ex" "$tmp_sp_u" || true)
rc=0
if [ -n "$missing" ]; then
  log_warn "keys in config.toml.example with no VAR_SPEC:"
  printf '%s\n' "$missing" | while IFS= read -r m; do log_warn "  missing $m"; done
  rc=1
fi
if [ -n "$unknown" ]; then
  log_warn "keys in VAR_SPECS not in config.toml.example:"
  printf '%s\n' "$unknown" | while IFS= read -r u; do log_warn "  unknown $u"; done
  rc=1
fi
if [ "$rc" -eq 0 ]; then
  log_info "spec parity OK: $(wc -l < "$tmp_ex") keys matched"
fi
exit "$rc"
