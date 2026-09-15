#!/usr/bin/env bash
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

# Why: every mutating server action / API route must leave an audit trail.
# This gate enforces recordAudit( coverage so silent writes cannot slip in.

# Allowlist for action files that legitimately lack auditing (read-only or delegated).
is_action_exempt() {
  case "$1" in
    admin-panel/src/app/actions/audit.ts) return 0 ;; # read-only query actions
    admin-panel/src/app/actions/auth.ts) return 0 ;; # login/logout — session events, not data mutations
    admin-panel/src/app/actions/search.ts) return 0 ;; # read-only
    admin-panel/src/app/actions/stats.ts) return 0 ;; # read-only
    admin-panel/src/app/actions/ranking.ts) return 0 ;; # read-only
    admin-panel/src/app/actions/workers.ts) return 0 ;; # read-only
    admin-panel/src/app/actions/participation-sql.ts) return 0 ;; # internal module, not a 'use server' entry point; callers audit
    *) return 1 ;;
  esac
}

# Allowlist for API routes that export mutating handlers but delegate auditing.
is_route_exempt() {
  case "$1" in
    admin-panel/src/app/api/users/batch/route.ts) return 0 ;; # delegates every write to users/batch/{credentialActions,enrollmentActions,profileActions}.ts, which audit
    *) return 1 ;;
  esac
}

has_prisma_write() {
  # Prisma write verbs or raw SQL writes
  # shellcheck disable=SC2016 # $executeRaw is a literal grep pattern, not an expansion
  if grep -qE '\.create\(|\.createMany\(|\.update\(|\.updateMany\(|\.delete\(|\.deleteMany\(|\.upsert\(|executeRaw|\$executeRaw' "$1"; then
    return 0
  fi
  # .query( only counts when file also contains INSERT/UPDATE/DELETE
  if grep -q '\.query(' "$1" && grep -qE 'INSERT|UPDATE|DELETE' "$1"; then
    return 0
  fi
  return 1
}

has_mutating_export() {
  grep -qE 'export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+(POST|PUT|PATCH|DELETE)\b' "$1"
}

# Why: mutations may be delegated to admin-panel/src/lib/services/ so the
# audit trail lives beside the write rather than in the entry point itself.
delegates_to_audited_service() {
  local entry_file="$1"
  local refs
  refs=$(grep -oE 'lib/services/[^"'\''`[:space:]]+' "$entry_file" 2>/dev/null | sed -E 's#^.*lib/services/##; s#\.(ts|js)$##' | sort -u || true)
  if [ -z "$refs" ]; then
    return 1
  fi
  local svc_path
  while IFS= read -r svc_path; do
    [ -z "$svc_path" ] && continue
    # Guard against trivially satisfiable imports by requiring the referenced
    # module to exist and to actually contain an audit call.
    local svc_file="${REPO_ROOT}/admin-panel/src/lib/services/${svc_path}.ts"
    if [ -f "$svc_file" ] && grep -q 'recordAudit(' "$svc_file"; then
      return 0
    fi
    local svc_index="${REPO_ROOT}/admin-panel/src/lib/services/${svc_path}/index.ts"
    if [ -f "$svc_index" ] && grep -q 'recordAudit(' "$svc_index"; then
      return 0
    fi
    # Allow top-level module to cover nested import (e.g., services/foo/bar
    # still passes if services/foo.ts audits) so future splits stay covered.
    local top="${svc_path%%/*}"
    if [ "$top" != "$svc_path" ]; then
      local top_file="${REPO_ROOT}/admin-panel/src/lib/services/${top}.ts"
      if [ -f "$top_file" ] && grep -q 'recordAudit(' "$top_file"; then
        return 0
      fi
    fi
  done <<< "$refs"
  return 1
}

offenders=""
checked=0

# Check action files
for file in "${REPO_ROOT}"/admin-panel/src/app/actions/*.ts; do
  [ -e "$file" ] || continue
  rel="${file#"${REPO_ROOT}/"}"
  if is_action_exempt "$rel"; then
    continue
  fi
  if has_prisma_write "$file"; then
    checked=$((checked + 1))
    if ! grep -q 'recordAudit(' "$file"; then
      if ! delegates_to_audited_service "$file"; then
        offenders="${offenders}${rel}"$'\n'
      fi
    fi
  fi
done

# Check API routes
while IFS= read -r -d '' file; do
  rel="${file#"${REPO_ROOT}/"}"
  if is_route_exempt "$rel"; then
    continue
  fi
  if has_mutating_export "$file"; then
    checked=$((checked + 1))
    if ! grep -q 'recordAudit(' "$file"; then
      if ! delegates_to_audited_service "$file"; then
        offenders="${offenders}${rel}"$'\n'
      fi
    fi
  fi
done < <(find "${REPO_ROOT}/admin-panel/src/app/api" -name "route.ts" -print0 2>/dev/null)

if [ -n "$offenders" ]; then
  printf 'Audit coverage FAILED:\n' >&2
  printf '%s' "$offenders" | while IFS= read -r line; do
    [ -n "$line" ] && printf '  %s\n' "$line" >&2
  done
  exit 1
fi

# Why: count checked files so success message is verifiable, not just silent.
printf 'Audit coverage OK (%s files checked)\n' "$checked"
