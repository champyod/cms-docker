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
readonly KIB_PER_GB=1048576

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
# Verify available disk space at <path>.
# WHY `df -Pk`: the monitor image is Alpine, so df is BusyBox and rejects both
# `--output` and `-B`, while `df -Pk` is the one spelling BusyBox and GNU
# coreutils agree on. Field 4 of the POSIX report is the available 1K blocks,
# and dividing by KIB_PER_GB turns those blocks into whole GB — the unit the
# thresholds and the log lines speak.
# Defaults honour DISK_FLOOR_GB / DISK_WARN_GB constants.
# Behaviour:
#   avail < floor  → log_die with exit code 2 (hard failure)
#   avail < warn   → log_warn (soft warning, continues)
#   otherwise      → log_info and return 0
require_disk_free_gb() {
  local target_path="${1:?require_disk_free_gb: <path> required}"
  local floor_gb="${2:-$DISK_FLOOR_GB}"
  local warn_gb="${3:-$DISK_WARN_GB}"
  local avail_kb
  local avail_gb

  # An empty field means df failed or the report carried no data line; to a
  # caller both are the same fault, so they share one message.
  if ! avail_kb=$(df -Pk "$target_path" 2>/dev/null | awk 'NR==2 {print $4}') || [ -z "$avail_kb" ]; then
    log_die "unable to determine disk space for: $target_path" 2
  fi

  if ! [[ "$avail_kb" =~ ^[0-9]+$ ]]; then
    log_die "unable to parse disk space value: $avail_kb" 2
  fi

  avail_gb=$(( avail_kb / KIB_PER_GB ))

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
    hint=" (check .env — run './cms config sync')"
  fi

  log_die "required variable ${var_name} is empty or unset${hint}" 1
}

# ---------------------------------------------------------------------------
# is_default_secret <value>
# ---------------------------------------------------------------------------
# Return 0 (true) when <value> matches the known-bad / default secret set:
#   empty, CHANGE_ME*, YOUR_*, *PASSWORD_HERE, cmspassword, usern4me,
#   passw0rd, 8e045a51e4b102ea803c06f92841a1fb, DEFAULT_SECRET_KEY, admin
# Return 1 otherwise.
is_default_secret() {
  local value="${1:-}"

  # Empty is always default/unsafe.
  if [[ -z "$value" ]]; then
    return 0
  fi

  # Literal known-bad values.
  case "$value" in
    cmspassword|usern4me|passw0rd|8e045a51e4b102ea803c06f92841a1fb|DEFAULT_SECRET_KEY|admin)
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
# env_unquote <value>
# ---------------------------------------------------------------------------
# Undo the quoting that scripts/__config_sync.sh's env_quote() writes into the
# generated .env. WHY it is needed: a raw reader (awk/grep/cut) sees the file
# bytes, so once a value is quoted to protect it from the shell it would come back
# as `'CMS restricted'` — quotes included — where `set -a; . ./.env` and
# `docker compose --env-file .env` both yield `CMS restricted`. Single-quoted
# values are literal; double-quoted values carry exactly the escapes env_quote
# emitted (\ \\ \" $ `). A bare value is returned unchanged, so a reader that never
# meets a quoted value behaves exactly as it did before.
env_unquote() {
  local v="${1-}"
  local body="" out="" ch=""

  case "$v" in
    '"'*'"') ;;                                        # double-quoted: decode below
    "'"*"'") printf '%s' "${v:1:${#v}-2}"; return 0 ;; # single-quoted: literal
    *) printf '%s' "$v"; return 0 ;;                   # bare: unchanged
  esac

  body="${v:1:${#v}-2}"
  while [[ -n "$body" ]]; do
    ch="${body:0:1}"
    body="${body:1}"
    # Left-to-right, so `\\\$` (an escaped backslash followed by an escaped dollar)
    # decodes to `\$` and not to `$`.
    if [[ -n "$body" && "$ch" == \\ ]]; then
      case "${body:0:1}" in
        \\|'"'|'$'|'\`') ch="${body:0:1}"; body="${body:1}" ;;
      esac
    fi
    out+="$ch"
  done
  printf '%s' "$out"
}

# ---------------------------------------------------------------------------
# backup_dir_writable_by_container
# ---------------------------------------------------------------------------
# <owner_uid> <group_gid> <mode> <container_uid> <container_gid> — returns 0 when
# one of the three ownership rules grants the container write access.
# WHY: backup_root_write_rule in scripts/__preflight.sh is the authority on that
# question — chowning a root which already satisfies its owner, group or other
# rule repairs nothing and costs a sudo password, so the same three rules, the
# same three-column mode parse and the same container-gid derivation apply here.
# A class counts only when its octal digit carries write and execute together
# (3 or 7), because creating an archive inside the root also needs the search bit.
backup_dir_writable_by_container() {
  local owner_uid="$1" group_gid="$2" container_uid="$4" container_gid="$5"
  local perms="$3"
  if [[ "$perms" =~ ^[0-9]+$ ]]; then
    perms="000${perms}"
  fi
  perms="${perms: -3}"
  if [[ "$owner_uid" == "$container_uid" && "${perms:0:1}" =~ [37] ]]; then
    return 0
  fi
  if [[ "$group_gid" == "$container_gid" && "${perms:1:1}" =~ [37] ]]; then
    return 0
  fi
  if [[ "${perms:2:1}" =~ [37] ]]; then
    return 0
  fi
  return 1
}

# ---------------------------------------------------------------------------
# backup_dir_group_writable <mode>
# ---------------------------------------------------------------------------
# Returns 0 when the owning-group class of <mode> is 7.
# WHY exactly 7 and not "carries write": the class is entered by search too, since
# creating an archive inside the root also needs the search bit — the reason
# backup_dir_writable_by_container counts only 3 or 7 — so read, write and search
# have to travel together or a group that looks writable is not enterable.
# <mode> is read on its last three octal digits, so the setgid digit this repair
# sets cannot shift the group column, and a non-numeric mode is rejected rather
# than guessed at.
backup_dir_group_writable() {
  local perms="${1:-}"
  if [[ "$perms" =~ ^[0-9]+$ ]]; then
    perms="000${perms}"
  fi
  perms="${perms: -3}"
  [[ "${perms:1:1}" == "7" ]]
}

# ---------------------------------------------------------------------------
# backup_dir_dual_writable <"owner_uid group_gid mode"> <container_uid>
# ---------------------------------------------------------------------------
# Returns 0 when BOTH writers reach the backup root: the container through the
# three-rule table in backup_dir_writable_by_container — the preflight gate's
# authority, called here rather than restated — and the host operator through the
# owning group, which after the ownership transfer is the only class left that
# reaches them.
# WHY both: the container's three rules alone are not the target state, and
# treating them as one is what produced a container-owned 700 tree the operator
# could no longer enter. A root the container reaches only through `other` is
# likewise not enough, because what a repaired root is asked to guarantee is the
# group.
backup_dir_dual_writable() {
  local owner_uid group_gid mode
  read -r owner_uid group_gid mode <<<"${1:-0 0 0}"
  backup_dir_writable_by_container "$owner_uid" "$group_gid" "$mode" "$2" "$2" \
    && backup_dir_group_writable "$mode"
}

# ---------------------------------------------------------------------------
# backup_dir_repair <root> <container_uid>
# ---------------------------------------------------------------------------
# Moves the tree to <container_uid>, keeps every group it already carries, and makes
# each directory rwx for its owning group with the setgid bit set, so entries the
# container creates inherit the group that reaches the host operator.
# WHY the group is left as it is: the operator's handle on the tree is the group
# they already belong to, so handing the group to the container gid would trade one
# lockout for another.
# WHY files are not touched: a backup archive carries database credentials, so the
# group is granted no write on the data and every file keeps the mode it was created
# with. The operator still removes archives, because unlinking needs write on the
# parent directory, which the group now has.
# Runs directly as root and otherwise behind one `sudo -v` followed by one
# privileged pass — one prompt, never a loop, never an assumed passwordless sudo.
backup_dir_repair() {
  local root="$1" uid="$2"
  if [[ "$(id -u)" -eq 0 ]]; then
    chown -R "$uid" "$root" || return 1
    find "$root" -type d -exec chmod g+rwx,g+s {} +
    return
  fi
  sudo -v 2>/dev/null || return 1
  sudo chown -R "$uid" "$root" || return 1
  sudo find "$root" -type d -exec chmod g+rwx,g+s {} +
}

# ---------------------------------------------------------------------------
# backup_dir_announce <root> <before_state> <after_state>
# ---------------------------------------------------------------------------
# Prints the change as before/after owner:group and mode.
# WHY loud: moving the owner off the operator's own uid is visible on a box someone
# is using, and the group that keeps them writing afterwards is the handle they are
# left with. The two states on consecutive lines are the record that survives a
# scrolled-back terminal, and the setgid note says why archives the container
# creates stay reachable instead of quietly turning private again.
backup_dir_announce() {
  local before_uid before_gid before_mode after_uid after_gid after_mode
  read -r before_uid before_gid before_mode <<<"$2"
  read -r after_uid after_gid after_mode <<<"$3"
  log_info "backup root repaired for both writers: $1"
  log_info "  before: ${before_uid}:${before_gid} ${before_mode}"
  log_info "  after:  ${after_uid}:${after_gid} ${after_mode}"
  log_info "  owner is the monitor uid; the host operator writes through group ${after_gid}, setgid on directories"
}

# ---------------------------------------------------------------------------
# ensure_backup_dir_perms
# ---------------------------------------------------------------------------
# WHY: the monitor container runs as ${DOCKER_UID:-1000} and writes archives under
# ${BACKUP_DIR:-<repo>/backups}, but a backup root belongs to whoever created it —
# the operator uid on a fresh install, a foreign uid on a restored box. The
# container then cannot create an archive, while the host shell that owns the
# directory still sees the path as writable, so ownership and mode are read from
# the filesystem and repaired here rather than only reported.
# The target is two writers, not the container alone: ownership moves to the
# container uid and every directory gains group rwx with setgid, because once the
# owner changed the operator is reachable only through the preserved group.
# Converging on owner-only modes is what locked an operator out of a container-owned
# 700 tree, so a root only the container passes is not finished and gets repaired on
# the next call too.
# A missing root is created, a root where both writers already pass returns
# silently so a repeat call costs and prints nothing, the repair runs directly as
# root or behind one `sudo -v` and one privileged run, and a repair that does not
# take prints the exact commands to run by hand and returns 1 without exiting — the
# caller decides if that is fatal.
ensure_backup_dir_perms() {
  local repo_root root uid state before

  repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
  root="${BACKUP_DIR:-${repo_root}/backups}"
  # WHY ${DOCKER_UID} and not ${DOCKER_GID} for the container gid: the monitor image
  # builds its group with addgroup -g ${DOCKER_UID}, so the gid equals the uid.
  uid="${DOCKER_UID:-1000}"

  if [[ ! -d "$root" ]]; then
    mkdir -p "$root" || { log_warn "cannot create backup root: ${root}"; return 1; }
  fi

  before="$(stat -c '%u %g %a' "$root" 2>/dev/null || true)"
  [[ -n "$before" ]] || {
    log_warn "cannot read ownership of backup root: ${root}"; return 1
  }
  if backup_dir_dual_writable "$before" "$uid"; then
    return 0
  fi

  # WHY the repair's own exit status is dropped: the outcome is read back off the
  # filesystem, so a privileged pass that was never allowed and one that changed
  # half the tree are judged by the same measured state instead of by how a command
  # happened to exit.
  backup_dir_repair "$root" "$uid" || true
  state="$(stat -c '%u %g %a' "$root" 2>/dev/null || true)"
  if ! backup_dir_dual_writable "$state" "$uid"; then
    log_warn "monitor (uid ${uid}) and the host operator cannot both write ${root} — run these as a user with sudo:
    sudo chown -R ${uid} ${root}
    sudo find ${root} -type d -exec chmod g+rwx,g+s {} +"
    return 1
  fi

  backup_dir_announce "$root" "$before" "$state"
  return 0
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
