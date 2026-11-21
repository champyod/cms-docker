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
# Database identity
# ---------------------------------------------------------------------------
# WHY every host-side client has to announce one: every table carries FORCE ROW LEVEL SECURITY
# and its policy reads `cms.actor` (admin-panel/prisma/migrations/20261025120000_rls_actor_policies).
# A client that sets nothing is not refused — it reads zero rows, and a write is a "UPDATE 0" or a
# quietly rejected INSERT with exit status 0. A script that is not told who it is therefore reports
# success over a database it changed nothing in, which is the failure these constants exist to end.
#
# WHY PGOPTIONS and not a SQL prefix: libpq reads PGOPTIONS when it connects and sends the settings
# in the startup packet, so one assignment covers every statement the client runs — a multi-statement
# `-c`, a `-f` script, COPY, and pg_restore's replay — with nothing prefixed onto any statement and no
# wrapper to forget. It is also the same handover the panel's own spawned clients use
# (admin-panel/src/app/actions/restore-apply-measure.ts), so both sides of the product announce
# themselves the same way.
#
# WHY the value is written once, here: a mistyped identity does not error. `public.cms_actor_is_staff()`
# matches an exact allowlist, so `system:migratoin` is indistinguishable from no actor at all — the
# rows just stop appearing. Spelling the string in one place is what makes a typo impossible rather
# than merely unlikely.
#
# The identities below are the ones the policy allowlist admits and that a host script can honestly
# claim; `admin:<id>` belongs to a signed-in human and is never a script's identity.
#   system:migration  schema/data work and bring-up — restores, migrations, provisioning renders.
#   system:cli        one change an operator asked for through ./cms.
readonly DB_ACTOR_SYSTEM_MIGRATION='-c cms.actor=system:migration'
readonly DB_ACTOR_SYSTEM_CLI='-c cms.actor=system:cli'

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
# resolve_bun
# ---------------------------------------------------------------------------
# Print the bun binary to run, or return 1 when none is installed. PATH first, then
# the two locations a bun installer writes without touching PATH: a non-interactive
# shell — a `docker exec`, a cron job, the panel's apply — never sources the profile
# that adds ~/.bun/bin, so a box with bun installed still looks bun-less to it.
resolve_bun() {
  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return 0
  fi
  local candidate
  for candidate in "${BUN_INSTALL:+$BUN_INSTALL/bin/bun}" "${HOME:+$HOME/.bun/bin/bun}"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

# ---------------------------------------------------------------------------
# Privileged execution
# ---------------------------------------------------------------------------
# One place decides how an action becomes root, so a new privileged step cannot
# grow its own escalation with its own availability check and its own advice.

# Compared as a string, not with -eq: an unreadable uid is empty, and "" -eq 0 is
# true, which would run privileged work as though it were already root.
is_root() { [[ "$(id -u)" == "0" ]]; }

# Run a command as root: directly when we are root, otherwise through sudo, and
# when sudo is absent refuse loudly with the exact command to run by hand.
run_privileged() {
  if is_root; then
    "$@"
    return
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    log_warn "not root and sudo is not installed — run this as root yourself: $*"
    return 1
  fi
  sudo "$@"
}

# tailscale answers the operator when tailscaled runs as one user and root
# otherwise, so it is tried as-is first and escalated only when that fails.
run_tailscale() {
  tailscale "$@" 2>/dev/null || run_privileged tailscale "$@"
}

# True when privileged work can run without prompting: already root, or sudo without
# a password. Callers that cannot wait on a prompt (the TUI, a cron, CI) check this
# before starting, so a half-applied change cannot be left behind a password dialog.
can_escalate() {
  if is_root; then
    return 0
  fi
  command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null
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
# Runs directly as root and otherwise through run_privileged — one prompt, never a
# loop, never an assumed passwordless sudo.
backup_dir_repair() {
  local root="$1" uid="$2"
  if is_root; then
    chown -R "$uid" "$root" || return 1
    find "$root" -type d -exec chmod g+rwx,g+s {} +
    return
  fi
  run_privileged chown -R "$uid" "$root" || return 1
  run_privileged find "$root" -type d -exec chmod g+rwx,g+s {} +
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
# WHY: the monitor container runs as ${DOCKER_UID:-1000} and writes archives under the
# host backup root (<repo>/backups, bind-mounted to /app/backups), but a backup root
# belongs to whoever created it — the operator uid on a fresh install, a foreign uid on
# a restored box. The
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
  # Host tree, not ${BACKUP_DIR}: that is the in-container path (/app/backups), which
  # nothing is mounted at on the host.
  root="${BACKUP_HOST_DIR:-${repo_root}/backups}"
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
# ensure_ranking_paths_perms [repo_root]
# ---------------------------------------------------------------------------
# WHY: POST /api/ranking/logo writes three paths and the panel runs as the image's `node`
# user (uid 1000). A fresh `cms-ranking-data` volume is seeded node:node from the panel
# image, but this deploy creates and populates it through a root helper first, so the
# directory stays root-owned and the build-time chown never reaches it. The host mirror
# config/assets is created root-owned the same way, and config.toml is writable only by
# whoever the deploy ran as. Each of the three is handed to the panel uid here, so an
# upload succeeds and the fix survives `down -v` and a fresh deploy.
# The volume is repaired from a root helper container — the panel cannot chown a tree it
# does not own, and the host need not be root. The two host paths are changed in place when
# the operator can and escalated once otherwise, the shape ensure_backup_dir_perms uses, so
# a deploy where they are already correct costs no sudo prompt. Modes stay world-readable:
# the ranking service reads the same volume as a different uid.
# repo_root: the tree the two host paths live in. The caller passes its own root —
#     config_sync's CMS_ROOT, which honours CMS_DOCKER_ROOT — so a test that runs the sync
#     against a throwaway tree repairs that tree, not the checkout.
ensure_ranking_paths_perms() {
  local repo_root uid mirror toml
  repo_root="${1:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)}"
  # The panel image runs its `node` user as uid 1000; PANEL_UID overrides it for a rebuild.
  uid="${PANEL_UID:-1000}"
  mirror="${repo_root}/config/assets"
  toml="${repo_root}/config.toml"

  if docker info >/dev/null 2>&1; then
    docker volume create cms-ranking-data >/dev/null 2>&1 || true
    docker run --rm -v cms-ranking-data:/data alpine sh -c \
      "chown -R ${uid}:${uid} /data && chmod -R u+rwX,go+rX /data" >/dev/null 2>&1 \
      || log_warn "cms-ranking-data may stay unwritable by the panel (uid ${uid})"
  else
    log_warn "docker unreachable — cms-ranking-data was not handed to the panel (uid ${uid})"
  fi

  mkdir -p "$mirror" 2>/dev/null || true
  chown -R "$uid:$uid" "$mirror" 2>/dev/null \
    || run_privileged chown -R "$uid:$uid" "$mirror" 2>/dev/null \
    || log_warn "config/assets may stay unwritable by the panel (uid ${uid})"

  if [[ -f "$toml" ]]; then
    # WHY group write rather than ownership: the deploy keeps editing config.toml, so the
    # panel is granted the same file through the group instead of being made its owner.
    chgrp "$uid" "$toml" 2>/dev/null || run_privileged chgrp "$uid" "$toml" 2>/dev/null || true
    chmod g+w "$toml" 2>/dev/null || run_privileged chmod g+w "$toml" 2>/dev/null || true
  fi
  return 0
}

# ---------------------------------------------------------------------------
# ensure_generated_dir_perms [repo_root]
# ---------------------------------------------------------------------------
# WHY: the exposure reconciler renders the front's vhosts into config/generated from inside a
# container, as the panel image's `node` user (uid 1000), while the directory belongs to whoever ran
# the deploy. Its first tick in production read the registry, then refused to write:
#   EACCES: permission denied, mkdir '/repo-root/config/generated/.staging'
# and kept the front's previous config — a reconciler that reconciles nothing, safely and silently.
# WHY owner = panel uid but group = the operator's group: chowning the directory to the panel alone
# takes it away from the deploy, which writes exposed-hosts.txt there as the operator. With owner
# 1000:operator-group and mode 0775 the reconciler writes as the owner and the deploy keeps writing
# as a group member, so neither side is locked out.
# WHY through a container: changing a host file's owner needs root, and this host has neither
# passwordless sudo nor setfacl — but the docker daemon is root and every deploy already requires it.
# The shape is ensure_ranking_paths_perms': quiet when already correct, one repair otherwise.
ensure_generated_dir_perms() {
  local repo_root uid gid dir
  repo_root="${1:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)}"
  uid="${PANEL_UID:-1000}"
  # Default to the group running the deploy: that identity keeps writing to the directory itself.
  gid="${PANEL_GID:-$(id -g)}"
  dir="${repo_root}/config/generated"

  mkdir -p "$dir" 2>/dev/null || true

  if [[ "$(stat -c '%u:%g:%a' "$dir" 2>/dev/null || true)" == "${uid}:${gid}:775" ]]; then
    return 0
  fi

  if docker info >/dev/null 2>&1; then
    docker run --rm --user 0:0 -v "${dir}:/g" alpine sh -c       "chown -R ${uid}:${gid} /g && chmod -R u+rwX,g+rwX /g" >/dev/null 2>&1 \
      || log_warn "config/generated may stay unwritable by the reconciler (uid ${uid})"
    return 0
  fi

  chown -R "${uid}:${gid}" "$dir" 2>/dev/null \
    || run_privileged chown -R "${uid}:${gid}" "$dir" 2>/dev/null \
    || log_warn "config/generated may stay unwritable by the reconciler (uid ${uid})"
  chmod -R u+rwX,g+rwX "$dir" 2>/dev/null || true
  return 0
}

# ---------------------------------------------------------------------------
# docker_exec_db <password> [NAME=VALUE ...] <docker exec args...>
# ---------------------------------------------------------------------------
# Run `docker exec` with a database password supplied through the docker client's
# environment rather than its argv. Every remaining argument is handed to `docker
# exec` unchanged, so the exec flags, the container, the client command, the
# caller's stdin redirection (a file, a heredoc, `-i`) and the exit status all
# behave exactly as a hand-written `docker exec` does.
# WHY the password cannot be an argv element: `-e PGPASSWORD=...` puts the secret
# in the docker client's own command line, and /proc/<pid>/cmdline is world
# readable, so every local user reads the production password for the lifetime of
# the call. Naming the variable only (`-e PGPASSWORD`, no `=value`) makes docker
# copy it out of the client's environment, which lives in /proc/<pid>/environ —
# readable by the owning user alone. The panel's postgresClientSpawn
# (admin-panel/src/app/actions/restore-apply-measure.ts) is the same handover on
# the TypeScript side; this is the one place the shell scripts do it.
# A call that needs a second secret in the container passes it the same way —
# `NAME=VALUE` before the exec args arrives as both an assignment for the client
# and a bare `-e NAME` for the container — so no caller reintroduces the `=value`
# form for a variable of its own (e.g. CMS_DB_PWD for __cms-db-init.sh's
# `bash -c`). A NAME=VALUE pair is unambiguous at the front of the argument list:
# a docker exec flag starts with `-` and a container name cannot contain `=`.
# This is also how a caller announces the identity it acts as: the database's policies
# read `cms.actor`, libpq reads it from `PGOPTIONS`, and `PGOPTIONS=...` handed here
# crosses into the container as a bare `-e PGOPTIONS`. See DB_ACTOR_SYSTEM_* above.
# Empty is allowed because callers such as db_exists pass `${POSTGRES_PASSWORD:-}`
# and a psql that then fails to authenticate is the caller's decision, not this
# function's; only a missing argument is an error.
docker_exec_db() {
  local db_pass="${1?docker_exec_db: <password> required}"
  shift
  local -a forwarded=() forwarded_names=()
  local pair=""

  while (( $# )) && [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; do
    pair="$1"
    shift
    forwarded+=("$pair")
    forwarded_names+=(-e "${pair%%=*}")
  done

  env "${forwarded[@]}" PGPASSWORD="$db_pass" \
    docker exec -e PGPASSWORD "${forwarded_names[@]}" "$@"
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

# ---------------------------------------------------------------------------
# docs_path_from_toml <repo_root>
# ---------------------------------------------------------------------------
# The docs_path the cms.toml under <repo_root>/config declares, or return 1 when the
# file is absent or the key is unset. The value is reported as written; it is
# container-internal in the shipped config, so a caller that cannot stat it records a
# skip rather than a failure.
docs_path_from_toml() {
  local repo_root="${1:?docs_path_from_toml: <repo_root> required}"
  local toml="${repo_root}/config/cms.toml"
  [[ -f "$toml" ]] || return 1
  awk -F'"' '/^[[:space:]]*docs_path[[:space:]]*=/ { print $2; exit }' "$toml"
}

# ---------------------------------------------------------------------------
# Backup observability — the textfile the monitoring stack scrapes
# ---------------------------------------------------------------------------
# WHY a textfile and not a new endpoint or a new container: node-exporter already
# runs in docker-compose.monitoring.yml with the host mounted read-only, and Prometheus
# already scrapes it. One file under the backup tree — which that mount already reaches
# through the explicit /metrics bind — turns "how old is the newest backup" into a time
# series with no new service, no restart of anything, and no second alerting path. The
# writer is the run that holds the fact (a backup run, an offsite sync), so the timestamp
# cannot drift from what is actually on disk.
#
# WHAT A READER MUST KNOW, because each of these is a way to read a green light off a
# red box:
#   * `*_timestamp_seconds 0` means NEVER, not 1970. No run has ever recorded a success
#     under this contract, so `*_stale` is 1 and `*_age_seconds` is the whole age of the
#     box. Fail closed: an unproven backup is not a green light.
#   * `*_age_seconds` is computed when the file is written, so the value that stays true
#     forever is the timestamp — `time() - cms_backup_last_success_timestamp_seconds` is
#     the age at scrape time. node_textfile_mtime_seconds{file="cms_backup.prom"} says
#     whether anything is still writing this file at all, which is the one fact a
#     timestamp cannot carry by itself.
#   * the cms_offsite_* families are ABSENT, not zero, when no offsite sync has ever run.
#     Absent is "not configured"; a zero would be a permanent alarm on every box that
#     never ships offsite, and an alarm nobody can clear stops being read.
BACKUP_METRICS_FILE="cms_backup.prom"
BACKUP_METRICS_SUCCESS_FILE="last-backup-success"
BACKUP_METRICS_OFFSITE_FILE="offsite-last-ship.env"
readonly BACKUP_METRICS_STALE_DEFAULT_HOURS=26

# backup_metrics_dir <backup_root> — where the textfile and the state files live.
# Beside db/ and manifest.json rather than in a directory of its own so the same bind
# mount the backup tree already has carries it, and one path means one directory.
backup_metrics_dir() {
  printf '%s/metrics' "${1%/}"
}

# _metrics_state_read <file> <KEY> — the value of one KEY=VALUE line, or nothing.
# WHY substr and not a field split: a destination carries ':' and can carry '=', so the
# value is everything after the first '=' of the matching line and nothing else.
_metrics_state_read() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  awk -v k="$key" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' \
    "$file" 2>/dev/null || true
}

# _metrics_write <file> <line>... — replace the file atomically.
# WHY a rename and not a write in place: Prometheus scrapes every 15s and a reader must
# never see half a family. The mode is 0644 because node-exporter runs as nobody in its
# own container and has to read the file; what it carries is ages, never a secret.
_metrics_write() {
  local file="$1"
  shift
  local dir tmp
  dir="$(dirname -- "$file")"
  mkdir -p -- "$dir" 2>/dev/null || return 1
  tmp="$(mktemp "${dir}/.$(basename -- "$file").XXXXXX" 2>/dev/null)" || return 1
  if ! printf '%s\n' "$@" > "$tmp" 2>/dev/null; then
    rm -f -- "$tmp"
    return 1
  fi
  chmod 644 "$tmp" 2>/dev/null || true
  if ! mv -- "$tmp" "$file" 2>/dev/null; then
    rm -f -- "$tmp"
    return 1
  fi
}

# record_backup_success <backup_root> <epoch> — the one write that says a run succeeded.
# WHY a separate marker and not the dump's mtime: a dump on disk is not proof of a
# recorded run — a run that kept its dump but could not record it exits 3, and its file
# would otherwise read as a success for the whole staleness window.
record_backup_success() {
  local root="${1:?record_backup_success: <backup_root> required}"
  local epoch="${2:?record_backup_success: <epoch> required}"
  [[ "$epoch" =~ ^[0-9]+$ ]] || return 1
  _metrics_write "$(backup_metrics_dir "$root")/${BACKUP_METRICS_SUCCESS_FILE}" \
    "LAST_BACKUP_SUCCESS_EPOCH=${epoch}"
}

# record_offsite_ship <backup_root> <epoch> <encrypted 0|1> <archives> <destination>
# WHY the destination and the encryption flag are stored with the timestamp: "the offsite
# copy is 30h old" is only actionable next to where it went and whether it went
# encrypted, and the ciphertext-or-not fact is the one an operator must be able to check
# without reading a log.
record_offsite_ship() {
  local root="${1:?record_offsite_ship: <backup_root> required}"
  local epoch="${2:?record_offsite_ship: <epoch> required}"
  local encrypted="${3:?record_offsite_ship: <encrypted> required}"
  local archives="${4:?record_offsite_ship: <archives> required}"
  local destination="${5:-unknown}"
  [[ "$epoch" =~ ^[0-9]+$ ]] || return 1
  [[ "$encrypted" == "0" || "$encrypted" == "1" ]] || return 1
  [[ "$archives" =~ ^[0-9]+$ ]] || return 1
  _metrics_write "$(backup_metrics_dir "$root")/${BACKUP_METRICS_OFFSITE_FILE}" \
    "OFFSITE_LAST_SHIP_EPOCH=${epoch}" \
    "OFFSITE_LAST_SHIP_ENCRYPTED=${encrypted}" \
    "OFFSITE_LAST_SHIP_ARCHIVES=${archives}" \
    "OFFSITE_LAST_SHIP_DESTINATION=${destination}"
}

# publish_backup_metrics <backup_root> [last_run_exit_code]
# Rewrites the textfile from what is on disk now, so any writer produces the same file
# for the same tree and two writers cannot disagree. Returns non-zero when the file could
# not be written; a caller reports that and never fails a backup over it — the backup is
# the product, this is the observation of it.
publish_backup_metrics() {
  local root="${1:?publish_backup_metrics: <backup_root> required}"
  local last_exit="${2:-}"
  local dir file now stale_after newest_dump dump_epoch success_epoch
  local stale=0
  local -a lines=()

  dir="$(backup_metrics_dir "$root")"
  file="${dir}/${BACKUP_METRICS_FILE}"
  now="$(date +%s)"

  # The same knob the monitor's own staleness warning reads, with the same default, so
  # the series and the log line can never disagree about when a backup is late.
  stale_after="${BACKUP_STALE_HOURS:-$BACKUP_METRICS_STALE_DEFAULT_HOURS}"
  [[ "$stale_after" =~ ^[0-9]+$ ]] || stale_after="$BACKUP_METRICS_STALE_DEFAULT_HOURS"

  newest_dump="$(ls -1t "${root%/}/db"/cmsdb-*.dump 2>/dev/null | head -n 1 || true)"
  dump_epoch=0
  if [[ -n "$newest_dump" ]]; then
    dump_epoch="$(stat -c %Y "$newest_dump" 2>/dev/null || echo 0)"
    [[ "$dump_epoch" =~ ^[0-9]+$ ]] || dump_epoch=0
  fi

  success_epoch="$(_metrics_state_read "${dir}/${BACKUP_METRICS_SUCCESS_FILE}" LAST_BACKUP_SUCCESS_EPOCH)"
  [[ "$success_epoch" =~ ^[0-9]+$ ]] || success_epoch=0
  # WHY the marker alone is not enough: it outlives the archive it describes — rotation,
  # a restore rehearsal or `down -v` can remove the dump while the marker stays — and a
  # timestamp naming a backup nobody can restore is worse than no timestamp at all. No
  # dump under db/ is "no proven backup", whatever the marker says.
  if (( dump_epoch == 0 )); then
    success_epoch=0
  fi
  if (( success_epoch == 0 )); then
    stale=1
  elif (( now - success_epoch > stale_after * 3600 )); then
    stale=1
  fi

  lines+=(
    "# HELP cms_backup_last_success_timestamp_seconds Unix time of the newest backup run that reported success; 0 means no run has ever recorded one."
    "# TYPE cms_backup_last_success_timestamp_seconds gauge"
    "cms_backup_last_success_timestamp_seconds ${success_epoch}"
    "# HELP cms_backup_last_success_age_seconds Age of that run in seconds as of the moment this file was written; without a recorded success it is the whole age of the box."
    "# TYPE cms_backup_last_success_age_seconds gauge"
    "cms_backup_last_success_age_seconds $(( now - success_epoch ))"
    "# HELP cms_backup_stale 1 when the newest proven backup is older than BACKUP_STALE_HOURS or no backup has ever been proven."
    "# TYPE cms_backup_stale gauge"
    "cms_backup_stale ${stale}"
    "# HELP cms_backup_newest_dump_timestamp_seconds Unix time of the newest cmsdb-*.dump on disk, whatever run wrote it; 0 means there is none."
    "# TYPE cms_backup_newest_dump_timestamp_seconds gauge"
    "cms_backup_newest_dump_timestamp_seconds ${dump_epoch}"
  )

  if [[ "$last_exit" =~ ^[0-9]+$ ]]; then
    local run_success=0
    (( last_exit == 0 )) && run_success=1
    lines+=(
      "# HELP cms_backup_last_run_exit_code Exit status of the most recent backup run (0 complete, 1 nothing usable, 2 disk guard, 3 dump unrecorded)."
      "# TYPE cms_backup_last_run_exit_code gauge"
      "cms_backup_last_run_exit_code ${last_exit}"
      "# HELP cms_backup_last_run_success 1 when the most recent backup run exited 0."
      "# TYPE cms_backup_last_run_success gauge"
      "cms_backup_last_run_success ${run_success}"
    )
  fi

  local offsite_file offsite_epoch offsite_age
  offsite_file="${dir}/${BACKUP_METRICS_OFFSITE_FILE}"
  if [[ -f "$offsite_file" ]]; then
    offsite_epoch="$(_metrics_state_read "$offsite_file" OFFSITE_LAST_SHIP_EPOCH)"
    [[ "$offsite_epoch" =~ ^[0-9]+$ ]] || offsite_epoch=0
    offsite_age=$(( now - offsite_epoch ))
    local offsite_stale=0
    if (( offsite_epoch == 0 )); then
      offsite_stale=1
    elif (( offsite_age > stale_after * 3600 )); then
      offsite_stale=1
    fi
    lines+=(
      "# HELP cms_offsite_last_ship_timestamp_seconds Unix time of the newest offsite sync that reported success; 0 means one has never succeeded."
      "# TYPE cms_offsite_last_ship_timestamp_seconds gauge"
      "cms_offsite_last_ship_timestamp_seconds ${offsite_epoch}"
      "# HELP cms_offsite_last_ship_age_seconds Age of that sync in seconds as of the moment this file was written."
      "# TYPE cms_offsite_last_ship_age_seconds gauge"
      "cms_offsite_last_ship_age_seconds ${offsite_age}"
      "# HELP cms_offsite_stale 1 when the newest offsite copy is older than BACKUP_STALE_HOURS."
      "# TYPE cms_offsite_stale gauge"
      "cms_offsite_stale ${offsite_stale}"
      "# HELP cms_offsite_last_ship_encrypted 1 when the newest offsite copy was encrypted before transfer, 0 when it was shipped in the clear."
      "# TYPE cms_offsite_last_ship_encrypted gauge"
      "cms_offsite_last_ship_encrypted $(_metrics_state_read "$offsite_file" OFFSITE_LAST_SHIP_ENCRYPTED)"
      "# HELP cms_offsite_last_ship_archives Number of archives in the newest offsite sync."
      "# TYPE cms_offsite_last_ship_archives gauge"
      "cms_offsite_last_ship_archives $(_metrics_state_read "$offsite_file" OFFSITE_LAST_SHIP_ARCHIVES)"
    )
  fi

  lines+=(
    "# HELP cms_backup_metrics_written_timestamp_seconds Unix time this file was written; if it stops advancing nothing is publishing backup ages any more."
    "# TYPE cms_backup_metrics_written_timestamp_seconds gauge"
    "cms_backup_metrics_written_timestamp_seconds ${now}"
  )

  _metrics_write "$file" "${lines[@]}"
}

# ---------------------------------------------------------------------------
# docs_language <docs_path>
# ---------------------------------------------------------------------------
# The language folder a docs tree exposes: the directory under <docs_path> holding an
# index.html, so cpp/index.html yields 'cpp'. WHY the tree is the whole rule: a cms.toml
# docs_language key never had a producer — neither the sample nor the [contest] inject
# list wrote one — so reading it could only echo what the tree already says, and the tree
# is the one folder a browser actually lands on. Returns 1 when no folder carries an entry
# page; callers report that as a skip, never a failure.
docs_language() {
  local docs_path="${1:?docs_language: <docs_path> required}" entry
  for entry in "$docs_path"/*/index.html; do
    [[ -f "$entry" ]] || continue
    entry="${entry%/index.html}"
    printf '%s' "${entry##*/}"
    return 0
  done
  return 1
}
