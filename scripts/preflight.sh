#!/usr/bin/env bash
# scripts/preflight.sh — pre-flight validation before bringing up CMS stacks.
# Usage: preflight.sh [--stack core|admin|contest|worker|monitor|all]
# Checks run in order; hard failures accumulate and produce exit 2 at the end.
# Warnings never block the run.

set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve repository root and load shared helpers.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

# Source common.sh via absolute path so it works regardless of cwd.
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
STACK="all"

print_usage() {
  printf 'Usage: %s [--stack core|admin|contest|worker|monitor|all]\n' "$(basename "$0")"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack)
      if [[ $# -lt 2 ]]; then
        log_die "missing value for --stack" 2
      fi
      STACK="$2"
      shift 2
      ;;
    --stack=*)
      STACK="${1#--stack=}"
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      printf '[FAIL] unknown argument: %s\n' "$1" >&2
      print_usage >&2
      exit 2
      ;;
  esac
done

case "$STACK" in
  core|admin|contest|worker|monitor|all) ;;
  *)
    log_die "invalid --stack value: ${STACK} (expected core|admin|contest|worker|monitor|all)" 2
    ;;
esac

# ---------------------------------------------------------------------------
# Result tracking — parallel arrays indexed 0..N-1
# ---------------------------------------------------------------------------
declare -a CHECK_NAMES=()
declare -a CHECK_STATUS=()   # PASS / WARN / FAIL
declare -a CHECK_DETAIL=()

HARD_FAIL_COUNT=0
WARN_COUNT=0

record_result() {
  local name="$1"
  local status="$2"   # PASS | WARN | FAIL
  local detail="${3:-}"
  CHECK_NAMES+=("$name")
  CHECK_STATUS+=("$status")
  CHECK_DETAIL+=("$detail")
  case "$status" in
    FAIL) HARD_FAIL_COUNT=$((HARD_FAIL_COUNT + 1)) ;;
    WARN) WARN_COUNT=$((WARN_COUNT + 1)) ;;
  esac
}

# Helpers to classify a stack selection
stack_includes() {
  local candidate="$1"
  if [[ "$STACK" == "all" ]]; then
    # 'all' logically includes every stack
    return 0
  fi
  [[ "$STACK" == "$candidate" ]]
}

# Whether the .env vars for a stack should be validated at all
should_validate_stack() {
  local s="$1"
  if [[ "$STACK" == "all" || "$STACK" == "$s" ]]; then
    return 0
  fi
  return 1
}

# ===========================================================================
# 1) Disk floor check
# ===========================================================================
check_disk() {
  local avail_raw avail_gb
  # Use require_disk_free_gb from common.sh but capture its exit so we can
  # record PASS/WARN/FAIL in the summary table instead of exiting immediately.
  # We run it in a subshell to trap the log_die exit 2 without killing preflight.
  local output exit_code
  # Temporarily disable errexit for this probe
  set +e
  output=$(require_disk_free_gb "$REPO_ROOT" 2>&1)
  exit_code=$?
  set -e

  # Echo the helper's own log line so the user still sees it
  printf '%s\n' "$output"

  if [[ $exit_code -eq 2 ]]; then
    record_result "disk floor (${DISK_FLOOR_GB}G)" "FAIL" "free < ${DISK_FLOOR_GB}G on ${REPO_ROOT}"
  elif [[ $exit_code -ne 0 ]]; then
    record_result "disk floor (${DISK_FLOOR_GB}G)" "FAIL" "disk check error"
  else
    # Distinguish WARN vs PASS by inspecting output
    if printf '%s' "$output" | grep -q "^\[WARN\]"; then
      record_result "disk floor (${DISK_FLOOR_GB}G)" "WARN" "free < ${DISK_WARN_GB}G (warn threshold)"
    else
      record_result "disk floor (${DISK_FLOOR_GB}G)" "PASS" "≥ ${DISK_FLOOR_GB}G free"
    fi
  fi
}

# ===========================================================================
# 2) Docker present + daemon reachable
# ===========================================================================
check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    printf '[FAIL] docker CLI not found in PATH\n' >&2
    record_result "docker daemon" "FAIL" "docker CLI not found"
    return 0
  fi

  if ! docker info >/dev/null 2>&1; then
    printf '[FAIL] docker daemon not reachable (docker info failed)\n' >&2
    record_result "docker daemon" "FAIL" "daemon unreachable — is dockerd running?"
    return 0
  fi

  printf '[INFO] docker daemon reachable\n'
  record_result "docker daemon" "PASS" "docker info succeeded"
}

# ===========================================================================
# 3) Environment variables per stack
# ===========================================================================
check_env() {
  local env_file="${REPO_ROOT}/.env"

  # Load .env if it exists — export all assignments so checks can read them.
  if [[ -f "$env_file" ]]; then
    set +e
    set -a
    # shellcheck disable=SC1090
    source "$env_file" 2>/dev/null || true
    set +a
    set -e
    printf '[INFO] loaded %s\n' "$env_file"
  else
    printf '[WARN] %s not found — skipping env checks (run: make env)\n' "$env_file" >&2
    record_result "env: core" "WARN" ".env missing"
    record_result "env: admin" "WARN" ".env missing"
    record_result "env: contest" "WARN" ".env missing"
    record_result "env: worker" "WARN" ".env missing"
    # monitor has no hard-required vars — still record PASS so summary is complete
    record_result "env: monitor" "PASS" "none hard-required"
    return 0
  fi

  # ---- core: POSTGRES_PASSWORD required, DB/USER defaults acceptable ----
  if should_validate_stack "core"; then
    local core_fail=""
    local val
    val="${POSTGRES_PASSWORD:-}"
    if [[ -z "$val" ]]; then
      core_fail="POSTGRES_PASSWORD empty (set in .env.core → .env)"
    elif is_default_secret "$val"; then
      core_fail="POSTGRES_PASSWORD is a default/placeholder value"
    fi
    if [[ -n "$core_fail" ]]; then
      printf '[FAIL] core env: %s\n' "$core_fail" >&2
      record_result "env: core" "FAIL" "$core_fail"
    else
      record_result "env: core" "PASS" "POSTGRES_PASSWORD set"
    fi
  else
    record_result "env: core" "PASS" "skipped (--stack ${STACK})"
  fi

  # ---- admin: AUTH_SECRET, RANKING_PASSWORD ----
  if should_validate_stack "admin"; then
    local admin_issues=()
    local v
    v="${AUTH_SECRET:-}"
    if [[ -z "$v" ]]; then
      admin_issues+=("AUTH_SECRET empty")
    elif is_default_secret "$v"; then
      admin_issues+=("AUTH_SECRET is default/placeholder")
    fi
    v="${RANKING_PASSWORD:-}"
    if [[ -z "$v" ]]; then
      admin_issues+=("RANKING_PASSWORD empty")
    elif is_default_secret "$v"; then
      admin_issues+=("RANKING_PASSWORD is default/placeholder")
    fi
    if [[ ${#admin_issues[@]} -gt 0 ]]; then
      local msg
      msg=$(IFS='; '; echo "${admin_issues[*]}")
      printf '[FAIL] admin env: %s\n' "$msg" >&2
      record_result "env: admin" "FAIL" "$msg"
    else
      record_result "env: admin" "PASS" "AUTH_SECRET, RANKING_PASSWORD set"
    fi
  else
    record_result "env: admin" "PASS" "skipped (--stack ${STACK})"
  fi

  # ---- contest: CONTEST_ID numeric, SECRET_KEY ----
  if should_validate_stack "contest"; then
    local contest_issues=()
    local cid="${CONTEST_ID:-}"
    local skey="${SECRET_KEY:-}"
    # Also check CONTEST_ID via ACTIVE_CONTEST_ID alias if needed — but spec
    # says contest→CONTEST_ID; also check ACTIVE_CONTEST_ID emptiness as hint.
    if [[ -z "$cid" ]]; then
      # Check if ACTIVE_CONTEST_ID / CONTESTS_DEPLOY_CONFIG present as fallback hint
      contest_issues+=("CONTEST_ID empty (set CONTEST_ID numeric in .env.contest)")
    elif ! [[ "$cid" =~ ^[0-9]+$ ]]; then
      contest_issues+=("CONTEST_ID='${cid}' not numeric")
    fi
    if [[ -z "$skey" ]]; then
      contest_issues+=("SECRET_KEY empty")
    elif is_default_secret "$skey"; then
      contest_issues+=("SECRET_KEY is default/placeholder")
    fi
    if [[ ${#contest_issues[@]} -gt 0 ]]; then
      local msg
      msg=$(IFS='; '; echo "${contest_issues[*]}")
      printf '[FAIL] contest env: %s\n' "$msg" >&2
      record_result "env: contest" "FAIL" "$msg"
    else
      record_result "env: contest" "PASS" "CONTEST_ID=${cid}, SECRET_KEY set"
    fi
  else
    record_result "env: contest" "PASS" "skipped (--stack ${STACK})"
  fi

  # ---- worker: WORKER_SHARD numeric, CORE_SERVICES_HOST not placeholder ----
  if should_validate_stack "worker"; then
    local worker_issues=()
    local shard="${WORKER_SHARD:-}"
    local cshost="${CORE_SERVICES_HOST:-}"
    if [[ -z "$shard" ]]; then
      worker_issues+=("WORKER_SHARD empty (must be numeric unique)")
    elif ! [[ "$shard" =~ ^[0-9]+$ ]]; then
      worker_issues+=("WORKER_SHARD='${shard}' not numeric")
    fi
    if [[ -z "$cshost" ]]; then
      worker_issues+=("CORE_SERVICES_HOST empty")
    elif [[ "$cshost" == "YOUR_CORE_IP_HERE" ]]; then
      worker_issues+=("CORE_SERVICES_HOST is placeholder YOUR_CORE_IP_HERE")
    elif is_default_secret "$cshost"; then
      worker_issues+=("CORE_SERVICES_HOST is default/placeholder")
    fi
    if [[ ${#worker_issues[@]} -gt 0 ]]; then
      local msg
      msg=$(IFS='; '; echo "${worker_issues[*]}")
      printf '[FAIL] worker env: %s\n' "$msg" >&2
      record_result "env: worker" "FAIL" "$msg"
    else
      record_result "env: worker" "PASS" "WORKER_SHARD=${shard}, CORE_SERVICES_HOST ok"
    fi
  else
    record_result "env: worker" "PASS" "skipped (--stack ${STACK})"
  fi

  # ---- monitor: none hard-required ----
  if should_validate_stack "monitor"; then
    record_result "env: monitor" "PASS" "none hard-required"
  else
    record_result "env: monitor" "PASS" "skipped (--stack ${STACK})"
  fi
}

# ===========================================================================
# 4) config/cms.toml exists and is a regular file
# ===========================================================================
check_cms_toml() {
  local toml_path="${REPO_ROOT}/config/cms.toml"

  if [[ -d "$toml_path" ]]; then
    printf '[FAIL] %s is a directory (known Docker-volume artifact bug)\n' "$toml_path" >&2
    printf '       Fix: rm -rf %s && cp config/cms.sample.toml %s && make env\n' "$toml_path" "$toml_path" >&2
    record_result "config/cms.toml" "FAIL" "is a directory — rm -rf + restore from cms.sample.toml"
    return 0
  fi

  if [[ -f "$toml_path" ]]; then
    printf '[INFO] config/cms.toml exists\n'
    record_result "config/cms.toml" "PASS" "regular file present"
    return 0
  fi

  printf '[FAIL] config/cms.toml missing — run: make env (or cp config/cms.sample.toml config/cms.toml)\n' >&2
  record_result "config/cms.toml" "FAIL" "file missing"
}

# ===========================================================================
# 5) Secrets file permissions — warn if world-readable
# ===========================================================================
check_secret_perms() {
  local files=("${REPO_ROOT}/.env" "${REPO_ROOT}/config/cms.toml")
  local warn_msgs=()

  for f in "${files[@]}"; do
    if [[ -f "$f" ]]; then
      local mode
      mode=$(stat -c '%a' "$f" 2>/dev/null || echo "")
      if [[ -z "$mode" ]]; then
        mode=$(stat -f '%OLp' "$f" 2>/dev/null || echo "600")
      fi
      local other="${mode: -1}"
      if [[ "$other" =~ [4-7] ]]; then
        printf '[WARN] %s is world-readable (mode %s) — suggest: chmod 600 %s (not auto-fixed)\n' "$f" "$mode" "$f" >&2
        warn_msgs+=("$(basename "$f"):${mode}")
      fi
    fi
  done

  if [[ ${#warn_msgs[@]} -gt 0 ]]; then
    local detail
    detail=$(IFS=', '; echo "${warn_msgs[*]}")
    record_result "secret perms" "WARN" "$detail world-readable — chmod 600 (not auto-fixed)"
  else
    record_result "secret perms" "PASS" "not world-readable"
  fi
}

# ===========================================================================
# 6) Port-collision quick check (warn only) — ss -ltn probe per stack
# ===========================================================================
check_ports() {
  local ports=()
  case "$STACK" in
    core)    ports=(5432 29000 28000 28500 22000) ;;
    admin)   ports=(8889 8890 8891) ;;
    contest) ports=(8888) ;;
    worker)  ports=(26000) ;;
    monitor) ports=() ;;
    all)     ports=(5432 29000 28000 28500 22000 8888 8889 8890 8891 26000) ;;
  esac

  if [[ ${#ports[@]} -eq 0 ]]; then
    record_result "port collisions" "PASS" "no ports to check for stack ${STACK}"
    return 0
  fi

  local busy=()
  local port_list=""
  # Prefer ss; fall back to netstat if needed
  local have_ss=0
  if command -v ss >/dev/null 2>&1; then
    have_ss=1
  fi

  for p in "${ports[@]}"; do
    local in_use=0
    if [[ $have_ss -eq 1 ]]; then
      if ss -ltn 2>/dev/null | grep -qE "[:.]${p}[[:space:]]"; then
        in_use=1
      fi
    elif command -v netstat >/dev/null 2>&1; then
      if netstat -ltn 2>/dev/null | grep -qE "[:.]${p}[[:space:]]"; then
        in_use=1
      fi
    else
      # No probe tool available — skip this check gracefully
      printf '[WARN] neither ss nor netstat found — skipping port-collision check\n' >&2
      record_result "port collisions" "WARN" "ss/netstat unavailable — skipped"
      return 0
    fi
    if [[ $in_use -eq 1 ]]; then
      busy+=("$p")
      printf '[WARN] port %s already listening — may collide with stack %s\n' "$p" "$STACK" >&2
    fi
  done

  if [[ ${#busy[@]} -gt 0 ]]; then
    local detail
    detail=$(IFS=', '; echo "${busy[*]}")
    record_result "port collisions" "WARN" "port(s) ${detail} already bound"
  else
    # Build port list for PASS detail
    port_list=$(IFS=','; echo "${ports[*]}")
    record_result "port collisions" "PASS" "ports ${port_list} free"
  fi
}

# ===========================================================================
# 7) Worker cgroup check (--stack worker only)
# ===========================================================================
check_worker_cgroup() {
  if [[ "$STACK" != "worker" ]]; then
    record_result "worker cgroup" "PASS" "skipped (--stack ${STACK})"
    return 0
  fi

  local cgroup_path="${ISOLATE_CGROUP_PATH:-/sys/fs/cgroup/cms-isolate}"
  local cgroup_control="${ISOLATE_CGROUP_CONTROL:-1}"

  if [[ "$cgroup_control" != "1" ]]; then
    printf '[INFO] ISOLATE_CGROUP_CONTROL=%s — cgroup delegation disabled, skipping dir check\n' "$cgroup_control"
    record_result "worker cgroup" "PASS" "ISOLATE_CGROUP_CONTROL!=1 — delegation disabled"
    return 0
  fi

  if [[ -d "$cgroup_path" ]]; then
    printf '[INFO] worker cgroup path exists: %s\n' "$cgroup_path"
    record_result "worker cgroup" "PASS" "${cgroup_path} exists"
    return 0
  fi

  printf '[FAIL] worker cgroup path missing: %s (ISOLATE_CGROUP_CONTROL=1)\n' "$cgroup_path" >&2
  printf '       Hint: run scripts/setup-worker-cgroup.sh on the worker host (as root) to create it\n' >&2
  record_result "worker cgroup" "FAIL" "${cgroup_path} missing — run setup-worker-cgroup.sh"
}

# ===========================================================================
# Main — run checks in order
# ===========================================================================
printf '=== CMS Preflight Checks (stack: %s) ===\n' "$STACK"

check_disk
check_docker
check_env
check_cms_toml
check_secret_perms
check_ports
check_worker_cgroup

# ===========================================================================
# Summary table
# ===========================================================================
printf '\n'
printf '┌─────────────────────────┬────────┬──────────────────────────────────────────────┐\n'
printf '│ Check                   │ Status │ Detail                                       │\n'
printf '├─────────────────────────┼────────┼──────────────────────────────────────────────┤\n'

for i in "${!CHECK_NAMES[@]}"; do
  local_name="${CHECK_NAMES[$i]}"
  local_status="${CHECK_STATUS[$i]}"
  local_detail="${CHECK_DETAIL[$i]}"
  # Truncate detail to fit table width
  local_detail_trunc="${local_detail:0:44}"
  printf '│ %-23s │ %-6s │ %-44s │\n' "$local_name" "$local_status" "$local_detail_trunc"
done

printf '└─────────────────────────┴────────┴──────────────────────────────────────────────┘\n'
printf 'Summary: %d PASS, %d WARN, %d FAIL (stack: %s)\n' \
  "$(printf '%s\n' "${CHECK_STATUS[@]}" | grep -c '^PASS$' || true)" \
  "$WARN_COUNT" \
  "$HARD_FAIL_COUNT" \
  "$STACK"

if [[ $HARD_FAIL_COUNT -gt 0 ]]; then
  printf '[FAIL] preflight found %d hard failure(s) — abort\n' "$HARD_FAIL_COUNT" >&2
  exit 2
fi

printf '[INFO] preflight passed (%d warning(s))\n' "$WARN_COUNT"
exit 0
