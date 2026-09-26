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

# ---------------------------------------------------------------------------
# Container-delivery contract
#
# A container only receives what a Dockerfile COPYs or a compose bind-mount names
# explicitly. __backup.sh sources ${SCRIPT_DIR}/__lib/common.sh, so handing that
# script over without the lib fails the source line and `set -e` ends the whole
# script — every delivery must carry the lib to the directory the script resolves
# against, in the image and in the mount alike.
# ---------------------------------------------------------------------------
LIB_DIR_NAME="__lib"

DOCKERFILES=()
for f in "${REPO_ROOT}/Dockerfile" "${REPO_ROOT}"/docker/*/Dockerfile; do
  if [ -f "$f" ]; then DOCKERFILES+=("$f"); fi
done

COMPOSE_FILES=()
for f in "${REPO_ROOT}"/docker-compose*.yml "${REPO_ROOT}"/docker/docker-compose*.yml; do
  if [ -f "$f" ]; then COMPOSE_FILES+=("$f"); fi
done

parse_dockerfile_copies() {
  # WHY: flags such as --chown sit between COPY and its operands, so flags are
  # dropped and the first two remaining words are read as source and destination.
  awk '
    /^[[:space:]]*#/ { next }
    tolower($1) == "copy" {
      n = 0
      for (i = 2; i <= NF; i++) {
        if ($i ~ /^--/) continue
        a[++n] = $i
      }
      if (n >= 2) print FILENAME "\t" a[1] "\t" a[2]
    }
  ' "$@"
}

parse_compose_mounts() {
  # WHY: only file mounts bear on this contract, so a service-scoped read is
  # enough — services are 2-space keys and their volume entries are list items.
  awk '
    /^[^[:space:]#]/ { in_services = ($0 ~ /^services:/); svc = ""; in_vol = 0; next }
    !in_services { next }
    /^  [A-Za-z0-9_.-]+:/ { svc = $1; sub(/:$/, "", svc); in_vol = 0; next }
    /^    volumes:/ { in_vol = 1; next }
    in_vol && /^    [^[:space:]]/ { in_vol = 0 }
    in_vol && /^[[:space:]]*-[[:space:]]/ {
      entry = substr($0, index($0, "-") + 2)
      sub(/[[:space:]]+#.*$/, "", entry)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", entry)
      if (split(entry, p, ":") >= 2) print FILENAME "\t" svc "\t" p[1] "\t" p[2]
    }
  ' "$@"
}

# One record per delivery: kind, defining file, service, host source, container path.
# The defining file stays absolute so the checks do not depend on the caller's
# working directory; the service column carries "-" for images, because a tab is
# IFS whitespace and consecutive tabs would collapse into a single delimiter.
delivered_scripts() {
  if [ "${#DOCKERFILES[@]}" -gt 0 ]; then
    parse_dockerfile_copies "${DOCKERFILES[@]}" | awk -F'\t' '{ print "image\t" $1 "\t-\t" $2 "\t" $3 }'
  fi
  if [ "${#COMPOSE_FILES[@]}" -gt 0 ]; then
    parse_compose_mounts "${COMPOSE_FILES[@]}" | awk -F'\t' '{ print "mount\t" $1 "\t" $2 "\t" $3 "\t" $4 }'
  fi
}

lib_refs() {
  grep -oE '__lib/[A-Za-z0-9_.-]+\.sh' "$1" 2>/dev/null | sort -u
}

# Only a delivered script that actually sources the lib creates an obligation,
# so the scripts that never touch it stay out of the report.
is_delivered_lib_user() {
  local candidate="$1"
  case "$candidate" in
    scripts/*/*|scripts/"${LIB_DIR_NAME}") return 1 ;;
    scripts/*) ;;
    *) return 1 ;;
  esac
  [ -f "${REPO_ROOT}/${candidate}" ] || return 1
  [ -n "$(lib_refs "${REPO_ROOT}/${candidate}")" ]
}

# A COPY of the lib directory is what makes SCRIPT_DIR/__lib resolve, and the
# destination has to be named __lib or the relative path still misses.
dockerfile_delivers_lib() {
  parse_dockerfile_copies "$1" | awk -F'\t' -v lib="$LIB_DIR_NAME" '
    $2 ~ ("(^|/)" lib "$") {
      n = split($3, seg, "/")
      if (seg[n] == lib) found = 1
    }
    END { exit(found ? 0 : 1) }
  '
}

# The mount has to land beside the script, because the script resolves __lib
# against its own SCRIPT_DIR and not against any fixed absolute location.
compose_service_delivers_lib() {
  parse_compose_mounts "$1" | awk -F'\t' -v svc="$2" -v want="$3" -v lib="$LIB_DIR_NAME" '
    $2 == svc && $3 ~ ("(^|/)" lib "$") && $4 == want { found = 1 }
    END { exit(found ? 0 : 1) }
  '
}

# A delivered script can only source a lib file that actually exists, so a
# renamed or deleted lib file is caught before it ever reaches a container.
# Column 4 of a delivery record is the host source for both kinds.
check_delivered_lib_files() {
  local script ref
  while read -r script; do
    while read -r ref; do
      if [ ! -f "${REPO_ROOT}/scripts/${ref}" ]; then
        printf '%s: sources %s but scripts/%s does not exist\n' "$script" "$ref" "$ref" >> "$tmp_violations"
        violations=$((violations + 1))
      fi
    done < <(lib_refs "${REPO_ROOT}/${script}")
  done < <(delivered_scripts | cut -f4 | sed 's|^\./||' | sort -u)
}

check_lib_delivery() {
  local kind file service src dst script rel want
  while IFS=$'\t' read -r kind file service src dst; do
    script="${src#./}"
    is_delivered_lib_user "$script" || continue
    rel="${file#"${REPO_ROOT}/"}"
    if [ "$kind" = "image" ]; then
      if ! dockerfile_delivers_lib "$file"; then
        printf '%s: sources __lib but %s never COPYs it — add: COPY scripts/%s %s/%s\n' \
          "$script" "$rel" "$LIB_DIR_NAME" "$(dirname "$dst")" "$LIB_DIR_NAME" >> "$tmp_violations"
        violations=$((violations + 1))
      fi
    else
      want="$(dirname "$dst")/${LIB_DIR_NAME}"
      if ! compose_service_delivers_lib "$file" "$service" "$want"; then
        printf '%s: sources __lib but the %s service in %s never mounts it — add: - %s/%s:%s:ro\n' \
          "$script" "$service" "$rel" "${src%/*}" "$LIB_DIR_NAME" "$want" >> "$tmp_violations"
        violations=$((violations + 1))
      fi
    fi
  done < <(delivered_scripts)
}

check_lib_delivery
check_delivered_lib_files

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
