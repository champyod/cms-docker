#!/usr/bin/env bash
# scripts/__db_use.sh — switch the active database profile.
#
# WHY a script rather than a function in the `cms` shim: the shim and the Rust CLI
# both route `db use` here, so the config mutation lives in one place
# (config.toml -> scripts/__config_sync.sh -> stack restart).
#
# Usage:
#   __db_use.sh <name>
#
# Exit codes: 0 = switched (or already active), 1 = refused or failed.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

# [db_<name>] profile names from config.toml, one per line. Empty when the file
# has no profile section yet (the old layout this script migrates).
profile_names() {
  grep -oE '^\[db_[^]]+\]' config.toml 2>/dev/null | sed -E 's/^\[db_(.+)\]$/\1/' || true
}

# ACTIVE_DATABASE as config.toml's [core] section declares it, or empty when the
# key is absent / its value is not a quoted string.
profile_active_name() {
  awk '
    /^\[core\]/ { in_core = 1 }
    /^\[/ && !/^\[core\]/ { in_core = 0 }
    in_core && /^ACTIVE_DATABASE[[:space:]]*=/ {
      if (match($0, /"[^"]*"/)) { print substr($0, RSTART + 1, RLENGTH - 2); exit }
    }
  ' config.toml 2>/dev/null || true
}

# A key's value inside a [db_<name>] profile, or empty when the profile does not set it.
# Used to check the switch target before it repoints every service.
profile_key() {
  local name="$1" key="$2"
  awk -v sec="[db_${name}]" -v k="$key" '
    $0 == sec { in_sec = 1; next }
    /^\[/ { in_sec = 0 }
    in_sec && $0 ~ ("^" k "[[:space:]]*=") {
      if (match($0, /"[^"]*"/)) { print substr($0, RSTART + 1, RLENGTH - 2); exit }
    }
  ' config.toml 2>/dev/null || true
}

usage() {
  cat <<'USAGE'
Usage:
  __db_use.sh <name>

  Switches the active database profile: rewrites [core] ACTIVE_DATABASE, runs
  ./cms config sync, and restarts any running stacks that read the database.
USAGE
}

# Rewrites [core] ACTIVE_DATABASE and reports what actually happened, so "did not
# change" and "could not change" stay distinguishable.
switch_active_profile() {
  local name="$1" tmp before after
  before="$(profile_active_name)"
  tmp="$(mktemp)"
  awk -v name="$name" '
    /^\[core\]/ { in_core = 1 }
    /^\[/ && !/^\[core\]/ { in_core = 0 }
    in_core && /^ACTIVE_DATABASE[[:space:]]*=/ {
      sub(/"[^"]*"/, "\"" name "\"")
    }
    { print }
  ' config.toml > "$tmp" && mv "$tmp" config.toml
  after="$(profile_active_name)"
  if [[ "$before" == "$name" ]]; then
    echo "ACTIVE_DATABASE is already \"${name}\" in config.toml — no change needed."
  elif [[ "$after" == "$name" ]]; then
    echo "ACTIVE_DATABASE set to \"${name}\" in config.toml"
  elif [[ -z "$after" ]]; then
    echo "Error: no ACTIVE_DATABASE key in the [core] section of config.toml (or its value is not a quoted string) — ACTIVE_DATABASE was NOT switched to \"${name}\"." >&2
    echo "Add/fix the key (see config.toml.example) or run './cms config sync' to merge missing keys, then retry." >&2
    return 1
  else
    echo "Error: ACTIVE_DATABASE is still \"${after}\" after the rewrite — it was NOT switched to \"${name}\"." >&2
    echo "Fix the key in the [core] section of config.toml, then retry." >&2
    return 1
  fi
}

restart_running_stacks() {
  local deploy_type
  local has_core=false has_admin=false has_contest=false has_worker=false has_infra=false
  deploy_type="$(grep -E '^DEPLOYMENT_TYPE=' .env 2>/dev/null | tail -n1 | cut -d '=' -f2 | cut -d '#' -f1 | tr -d '[:space:]' | tr -d '\"' | tr -d "'" || true)"
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qE '^cms-(database|log-service|resource-service|evaluation-service|scoring-service|proxy-service|checker-service)$'; then has_core=true; fi
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qE '^cms-(admin-panel-next|admin-web-server|ranking-web-server)$'; then has_admin=true; fi
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qE '^cms-contest-web-server($|-)'; then has_contest=true; fi
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qE '^cms-worker($|-)'; then has_worker=true; fi
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'cms-monitor'; then has_infra=true; fi

  if [[ "$has_core" == false && "$has_admin" == false && "$has_contest" == false && "$has_worker" == false && "$has_infra" == false ]]; then
    echo "No running CMS stacks detected — skipping restart."
    return 0
  fi

  echo "Restarting affected stacks (core=$has_core admin=$has_admin contest=$has_contest worker=$has_worker infra=$has_infra)..."
  if [[ "$deploy_type" == "img" ]]; then
    [[ "$has_core" == true ]]    && make -e DEPLOYMENT_TYPE_OVERRIDE=img core
    [[ "$has_infra" == true ]]   && make -e DEPLOYMENT_TYPE_OVERRIDE=img infra
    [[ "$has_admin" == true ]]   && make -e DEPLOYMENT_TYPE_OVERRIDE=img admin
    [[ "$has_contest" == true ]] && make -e DEPLOYMENT_TYPE_OVERRIDE=img contest
    [[ "$has_worker" == true ]]  && make -e DEPLOYMENT_TYPE_OVERRIDE=img worker
  else
    [[ "$has_core" == true ]]    && make core
    [[ "$has_infra" == true ]]   && make infra
    [[ "$has_admin" == true ]]   && make admin
    [[ "$has_contest" == true ]] && make contest
    [[ "$has_worker" == true ]]  && make worker
  fi
  return 0
}

main() {
  local name="${1:-}"
  if [[ -z "$name" ]]; then
    usage >&2
    exit 1
  fi
  if [[ ! "$name" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "Error: invalid profile name '${name}' (allowed: letters, digits, '_', '-')." >&2
    exit 1
  fi

  if ! grep -q "^\[db_${name}\]" config.toml; then
    if ! grep -q '^\[db_' config.toml; then
      # Old layout: POSTGRES_* still live under [core], so config sync must migrate
      # them into [db_default] first — switching before that names a section the
      # sync would not resolve.
      echo "config.toml uses the old layout (no [db_*] sections yet) — migrating POSTGRES_* into [db_default] first." >&2
      echo "Running './cms config sync' (scripts/__config_sync.sh) as the migration step..." >&2
      if ! bash scripts/__config_sync.sh; then
        echo "Error: migration failed — ACTIVE_DATABASE was NOT switched and .env was not rewritten. Fix the error above, then retry (or run './cms config sync' on its own)." >&2
        exit 1
      fi
      if ! grep -q "^\[db_${name}\]" config.toml; then
        echo "Error: migration finished but config.toml still has no [db_${name}] section." >&2
        echo "Available profiles:" >&2
        profile_names >&2
        exit 1
      fi
    else
      echo "Error: no [db_${name}] section in config.toml." >&2
      echo "Available profiles:" >&2
      profile_names >&2
      exit 1
    fi
  fi

  # A profile that names a database the server does not have would repoint every service
  # at a database that cannot answer, so warn before the switch, not after.
  local target_db target_user
  target_db="$(profile_key "$name" POSTGRES_DB)"
  target_user="$(profile_key "$name" POSTGRES_USER)"
  if [[ -n "$target_db" ]] && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx cms-database; then
    if ! docker exec cms-database psql -U "${target_user:-cmsuser}" -d postgres -tAc \
           "SELECT 1 FROM pg_database WHERE datname = '${target_db}'" 2>/dev/null | grep -q 1; then
      echo "WARNING: [db_${name}] points at database '${target_db}', which does not exist on cms-database." >&2
      echo "         Switching would repoint every service at a database that cannot answer." >&2
      echo "         Create it first, or fix POSTGRES_DB in [db_${name}]." >&2
    fi
  fi

  switch_active_profile "$name" || exit 1

  if ! bash scripts/__config_sync.sh; then
    echo "Error: ACTIVE_DATABASE is now \"${name}\" in config.toml, but './cms config sync' failed — .env may still describe the previous profile. Fix the error above, then run './cms config sync'." >&2
    exit 1
  fi

  restart_running_stacks
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
