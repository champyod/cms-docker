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
      offenders="${offenders}${rel}"$'\n'
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
      offenders="${offenders}${rel}"$'\n'
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
