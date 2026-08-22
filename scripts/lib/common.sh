#!/usr/bin/env bash
# scripts/lib/common.sh — shared strict-mode helpers for CMS Docker scripts.
# Sourced by multiple entry points; must remain idempotent and side-effect free
# on re-source. All callers receive the same constants and function contract.

# Guard against double-source: skip re-definition when already loaded.
if [[ -n "${_CMS_COMMON_SH_LOADED:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi
_CMS_COMMON_SH_LOADED=1

# Strict mode — scoped safely for a sourced library.
# Using `set -euo pipefail` at source time is conventional; callers that
# need relaxed behaviour must handle it. Functions themselves assume strictness.
set -euo pipefail

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
readonly DISK_FLOOR_GB=3
readonly DISK_WARN_GB=5

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

# Print an informational message to stdout.
log_info() {
  printf '[INFO] %s\n' "$*"
}

# Print a warning message to stderr.
log_warn() {
  printf '[WARN] %s\n' "$*" >&2
}

# Print an error message to stderr and exit.
# Usage: log_die "message" [exit_code]
# Default exit code is 1; callers needing code 2 pass it explicitly.
log_die() {
  local msg="${1:-fatal error}"
  local code="${2:-1}"
  printf '[FAIL] %s\n' "$msg" >&2
  exit "$code"
}

# ---------------------------------------------------------------------------
# require_disk_free_gb <path> [floor_gb] [warn_gb]
# ---------------------------------------------------------------------------
# Verify available disk space at <path> using `df -BG`.
# Defaults honour DISK_FLOOR_GB / DISK_WARN_GB constants.
# Behaviour:
#   avail < floor  → log_die with exit code 2 (hard failure)
#   avail < warn   → log_warn (soft warning, continues)
#   otherwise      → log_info and return 0
require_disk_free_gb() {
  local target_path="${1:?require_disk_free_gb: <path> required}"
  local floor_gb="${2:-$DISK_FLOOR_GB}"
  local warn_gb="${3:-$DISK_WARN_GB}"
  local avail_gb
  local avail_raw

  if ! avail_raw=$(df -BG --output=avail "$target_path" 2>/dev/null | tail -n 1); then
    log_die "unable to determine disk space for: $target_path" 2
  fi

  # df -BG outputs like "  123G" — strip whitespace and trailing G.
  avail_raw=$(printf '%s' "$avail_raw" | tr -d '[:space:]')
  avail_gb="${avail_raw%G}"
  # Handle potential decimal (e.g. GNU coreutils never emits decimals for -BG
  # but be defensive): truncate.
  avail_gb="${avail_gb%%.*}"

  if ! [[ "$avail_gb" =~ ^[0-9]+$ ]]; then
    log_die "unable to parse disk space value: $avail_raw" 2
  fi

  if (( avail_gb < floor_gb )); then
    log_die "disk space ${avail_gb}G < floor ${floor_gb}G at ${target_path}" 2
  fi

  if (( avail_gb < warn_gb )); then
    log_warn "disk space low: ${avail_gb}G < warn ${warn_gb}G at ${target_path}"
  else
    log_info "disk space OK: ${avail_gb}G available at ${target_path}"
  fi
}

# ---------------------------------------------------------------------------
# require_env <VAR> [source_file]
# ---------------------------------------------------------------------------
# Ensure environment variable VAR is set and non-empty.
# On failure: logs a FAIL message indicating which .env section should define
# the variable, then exits 1.
require_env() {
  local var_name="${1:?require_env: <VAR> required}"
  local source_file="${2:-}"
  local var_value=""

  # Indirect expansion — safe under `set -u` via :- default.
  var_value="${!var_name:-}"

  if [[ -n "$var_value" ]]; then
    return 0
  fi

  local hint=""
  if [[ -n "$source_file" ]]; then
    hint=" (expected in ${source_file})"
  else
    hint=" (check .env / .env.* for ${var_name})"
  fi

  log_die "required variable ${var_name} is empty or unset${hint}" 1
}

# ---------------------------------------------------------------------------
# is_default_secret <value>
# ---------------------------------------------------------------------------
# Return 0 (true) when <value> matches the known-bad / default secret set:
#   empty, CHANGE_ME*, YOUR_*, *PASSWORD_HERE, cmspassword, usern4me,
#   passw0rd, 8e045a51e4b102ea803c06f92841a1fb, DEFAULT_SECRET_KEY
# Return 1 otherwise.
is_default_secret() {
  local value="${1:-}"

  # Empty is always default/unsafe.
  if [[ -z "$value" ]]; then
    return 0
  fi

  # Literal known-bad values.
  case "$value" in
    cmspassword|usern4me|passw0rd|8e045a51e4b102ea803c06f92841a1fb|DEFAULT_SECRET_KEY)
      return 0
      ;;
  esac

  # Prefix / substring patterns.
  if [[ "$value" == CHANGE_ME* ]]; then
    return 0
  fi
  if [[ "$value" == YOUR_* ]]; then
    return 0
  fi
  if [[ "$value" == *PASSWORD_HERE* ]]; then
    return 0
  fi

  return 1
}

# ---------------------------------------------------------------------------
# ensure_docker_resource_network <name>
# ---------------------------------------------------------------------------
# Idempotently ensure a Docker network exists. Creates it if missing and logs
# the action taken.
ensure_docker_resource_network() {
  local net_name="${1:?ensure_docker_resource_network: <name> required}"

  if docker network inspect "$net_name" >/dev/null 2>&1; then
    log_info "docker network '${net_name}' already exists"
    return 0
  fi

  log_info "creating docker network '${net_name}'"
  if docker network create "$net_name" >/dev/null 2>&1; then
    log_info "docker network '${net_name}' created"
  else
    log_die "failed to create docker network '${net_name}'" 1
  fi
}

# ---------------------------------------------------------------------------
# ensure_docker_resource_volume <name>
# ---------------------------------------------------------------------------
# Idempotently ensure a Docker volume exists. Creates it if missing and logs
# the action taken.
ensure_docker_resource_volume() {
  local vol_name="${1:?ensure_docker_resource_volume: <name> required}"

  if docker volume inspect "$vol_name" >/dev/null 2>&1; then
    log_info "docker volume '${vol_name}' already exists"
    return 0
  fi

  log_info "creating docker volume '${vol_name}'"
  if docker volume create "$vol_name" >/dev/null 2>&1; then
    log_info "docker volume '${vol_name}' created"
  else
    log_die "failed to create docker volume '${vol_name}'" 1
  fi
}
