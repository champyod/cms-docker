#!/usr/bin/env bash
# scripts/__preflight.sh — pre-flight validation before bringing up CMS stacks.
# Usage: preflight.sh [--stack core|admin|contest|worker|monitor|all]
# Checks run in order; hard failures accumulate and produce exit 2 at the end.
# Warnings never block the run.

set -eu
# pipefail only if available
if (set -o pipefail 2>/dev/null); then
    set -o pipefail
fi

# ---------------------------------------------------------------------------
# Resolve repository root and load shared helpers.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

# Source common.sh via absolute path so it works regardless of cwd.
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/__lib/common.sh"

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
      core_fail="POSTGRES_PASSWORD empty (set in config.toml [core], then run: ./cms config sync)"
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

  # ---- admin: AUTH_SECRET ----
  if should_validate_stack "admin"; then
    local admin_issues=()
    local v
    v="${AUTH_SECRET:-}"
    if [[ -z "$v" ]]; then
      admin_issues+=("AUTH_SECRET empty")
    elif is_default_secret "$v"; then
      admin_issues+=("AUTH_SECRET is default/placeholder")
    fi
    if [[ ${#admin_issues[@]} -gt 0 ]]; then
      local msg
      msg=$(IFS='; '; echo "${admin_issues[*]}")
      printf '[FAIL] admin env: %s\n' "$msg" >&2
      record_result "env: admin" "FAIL" "$msg"
    else
      record_result "env: admin" "PASS" "AUTH_SECRET set"
    fi
  else
    record_result "env: admin" "PASS" "skipped (--stack ${STACK})"
  fi

  # ---- contest: CONTEST_ID numeric, SECRET_KEY ----
  if should_validate_stack "contest"; then
    local contest_issues=()
    local cid="${CONTEST_ID:-}"
    local skey="${SECRET_KEY:-}"
    if [[ -z "$cid" ]]; then
      contest_issues+=("CONTEST_ID empty (set CONTEST_ID numeric in config.toml [contest])")
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
# 6) Login CAPTCHA settings — only meaningful when the admin panel enables it
# ===========================================================================
# The CAPTCHA secret is issued by the provider, so it can never be generated
# locally. A missing key silently disables the challenge (isCaptchaConfigured
# in the panel requires both keys) and a generated-hex placeholder passes every
# "is it set" test while failing every verification call. Both states look
# healthy at runtime and are caught here instead.
captcha_is_active() {
  local raw="${CAPTCHA_ENABLED:-}"
  [[ "$raw" == "1" || "${raw,,}" == "true" ]]
}

check_captcha() {
  if ! stack_includes "admin"; then
    record_result "captcha config" "PASS" "skipped (--stack ${STACK})"
    return 0
  fi

  if ! captcha_is_active; then
    record_result "captcha config" "PASS" "CAPTCHA_ENABLED=${CAPTCHA_ENABLED:-0}"
    return 0
  fi

  local captcha_issues=()
  local site_key="${CAPTCHA_SITE_KEY:-}"
  local secret_key="${CAPTCHA_SECRET_KEY:-}"

  if [[ -z "$site_key" ]]; then
    captcha_issues+=("CAPTCHA_SITE_KEY empty (CAPTCHA_ENABLED=1)")
  fi
  if [[ -z "$secret_key" ]]; then
    captcha_issues+=("CAPTCHA_SECRET_KEY empty (CAPTCHA_ENABLED=1)")
  elif [[ "$secret_key" =~ ^[0-9a-f]{64}$ ]]; then
    captcha_issues+=("CAPTCHA_SECRET_KEY is a 64-char hex placeholder, not a provider secret — replace with the secret from the ${CAPTCHA_PROVIDER:-turnstile} dashboard")
  fi

  if [[ ${#captcha_issues[@]} -gt 0 ]]; then
    local msg
    msg=$(IFS='; '; echo "${captcha_issues[*]}")
    printf '[FAIL] captcha env: %s\n' "$msg" >&2
    printf '       Fix: paste the real CAPTCHA_SITE_KEY and CAPTCHA_SECRET_KEY from the provider dashboard, or set CAPTCHA_ENABLED=0 to run without it\n' >&2
    record_result "captcha config" "FAIL" "$msg"
    return 0
  fi

  record_result "captcha config" "PASS" "CAPTCHA_ENABLED=1, keys set"
}

# ===========================================================================
# 7) Secrets file permissions — warn if world-readable
# ===========================================================================
check_secret_perms() {
  local files=("${REPO_ROOT}/.env" "${REPO_ROOT}/config/cms.toml")
  local warn_msgs=()

  # chmod is a no-op on non-POSIX filesystems (ntfs/fuseblk) — check is meaningless there.
  local fstype
  fstype=$(stat -f -c %T "${REPO_ROOT}" 2>/dev/null || echo "unknown")
  if [[ "$fstype" == "fuseblk" || "$fstype" == fuse* || "$fstype" == *ntfs* ]]; then
    record_result "secret perms" "PASS" "skipped (${fstype} mount ignores chmod)"
    return 0
  fi

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
# 7) Port-collision quick check (warn only) — ss -ltn probe per stack
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
    port_list=$(IFS=','; echo "${ports[*]}")
    record_result "port collisions" "PASS" "ports ${port_list} free"
  fi
}

# ===========================================================================
# 8) Worker cgroup check (--stack worker only)
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
  printf '       Hint: run scripts/__worker_cgroup_setup.sh on the worker host (as root) to create it\n' >&2
  record_result "worker cgroup" "FAIL" "${cgroup_path} missing — run setup-worker-cgroup.sh"
}

# ===========================================================================
# 9) Monitor backup write access — backup-root ownership vs the container uid
# ===========================================================================
# The monitor container is not root, so it writes under the uid it was built
# for. A backup root owned by a different uid then fails every cycle while the
# host shell — which owns that directory — reports the same path as writable.
# Ownership and mode are therefore read from the filesystem, never from `test
# -w`, which answers for the operator instead of for the container.
#
# Prints which rule grants the container write access to the backup root and
# returns 0, or returns 1 when no rule applies. <mode> is read on its last three
# octal digits so a setuid or sticky digit cannot shift the group/other columns.
# Creating a directory inside the root also needs the search bit, so a class
# counts only when its octal digit carries write and execute together — 3 or 7.
backup_root_write_rule() {
  local owner_uid="$1" group_gid="$2" mode="$3" container_uid="$4" container_gid="$5"
  local perms="$mode"
  # WHY pad: stat -c %a prints the minimal octal form, so a mode below 100
  # arrives shorter than the three columns indexed below and every offset
  # slice of it would come back empty. Zeros are prefixed and the last three
  # digits kept, which left-pads short modes and still trims a setuid or
  # sticky digit, and it never parses the value as a number, so a leading
  # zero in <mode> survives. A non-numeric mode is left untouched and the
  # column tests below reject it.
  if [[ "$perms" =~ ^[0-9]+$ ]]; then
    perms="000${perms}"
  fi
  perms="${perms: -3}"
  if [[ "$owner_uid" == "$container_uid" && "${perms:0:1}" =~ [37] ]]; then
    printf 'owner uid %s\n' "$owner_uid"
    return 0
  fi
  if [[ "$group_gid" == "$container_gid" && "${perms:1:1}" =~ [37] ]]; then
    printf 'group %s write (mode %s)\n' "$group_gid" "$mode"
    return 0
  fi
  if [[ "${perms:2:1}" =~ [37] ]]; then
    printf 'other-write (mode %s)\n' "$mode"
    return 0
  fi
  return 1
}

check_monitor_backup_access() {
  if ! stack_includes "monitor"; then
    record_result "monitor backup access" "PASS" "skipped (--stack ${STACK})"
    return 0
  fi

  local backup_root="${BACKUP_DIR:-${REPO_ROOT}/backups}"
  local container_uid="${DOCKER_UID:-1000}"
  # WHY ${container_uid} and not ${DOCKER_GID:-999}: docker/monitor/Dockerfile
  # creates the monitor group with addgroup -g ${DOCKER_UID}, so the container gid
  # is the same number as its uid; DOCKER_GID is granted on docker.sock alone and
  # never reaches file access.
  local container_gid="${container_uid}"

  # Inspect only — a box that has never written a backup has no root to judge.
  if [[ ! -d "$backup_root" ]]; then
    record_result "monitor backup access" "PASS" "no backup root yet (${backup_root})"
    return 0
  fi

  local stat_line
  if ! stat_line=$(stat -c '%u %g %a' "$backup_root" 2>/dev/null) || [[ -z "$stat_line" ]]; then
    printf '[FAIL] cannot read ownership of %s\n' "$backup_root" >&2
    record_result "monitor backup access" "FAIL" "stat failed on ${backup_root}"
    return 0
  fi

  local owner_uid group_gid mode rule=""
  read -r owner_uid group_gid mode <<<"$stat_line"
  if ! rule=$(backup_root_write_rule "$owner_uid" "$group_gid" "$mode" "$container_uid" "$container_gid"); then
    printf '[FAIL] monitor cannot write %s: uid %s mode %s, container runs as uid %s gid %s\n' \
      "$backup_root" "$owner_uid" "$mode" "$container_uid" "$container_gid" >&2
    printf '       Fix: sudo chown -R %s %s   or: export DOCKER_UID=%s\n' \
      "$container_uid" "$backup_root" "$owner_uid" >&2
    record_result "monitor backup access" "FAIL" \
      "uid ${owner_uid} mode ${mode}; container uid ${container_uid} cannot write"
    return 0
  fi

  record_result "monitor backup access" "PASS" "$rule"
}

# ===========================================================================
# Main — run checks in order
# ===========================================================================
printf '=== CMS Preflight Checks (stack: %s) ===\n' "$STACK"

check_config_stale() {
  # Warn-only: a container started before config.toml last changed may run
  # stale values (edits apply on recreate, not while running).
  if [[ ! -f "$REPO_ROOT/config.toml" ]]; then
    record_result "config freshness" "PASS" "no config.toml"
    return 0
  fi
  if ! command -v docker >/dev/null 2>&1; then
    record_result "config freshness" "PASS" "docker unavailable"
    return 0
  fi
  local cfg_mtime stale_list name started started_epoch
  cfg_mtime=$(stat -c %Y "$REPO_ROOT/config.toml" 2>/dev/null || echo 0)
  stale_list=""
  while read -r name _rest; do
    [[ "$name" == cms-* ]] || continue
    started=$(docker inspect -f '{{.State.StartedAt}}' "$name" 2>/dev/null || echo "")
    [[ -n "$started" ]] || continue
    started_epoch=$(date -d "$started" +%s 2>/dev/null || echo 0)
    if [[ "$started_epoch" -lt "$cfg_mtime" ]]; then
      stale_list="${stale_list:+$stale_list, }$name"
    fi
  done < <(docker ps --format '{{.Names}}' 2>/dev/null || true)
  if [[ -n "$stale_list" ]]; then
    record_result "config freshness" "WARN" "predates config.toml: $stale_list"
  else
    record_result "config freshness" "PASS" "containers newer than config"
  fi
}

# ===========================================================================
# 11) Initial TLS certificate — the domain stack has no cert to serve :443
# ===========================================================================
# WHY this needs its own check: certbot's renewal loop runs forever whether or not
# the first issuance ever succeeded, so a fresh domain stack with no certificate
# looks identical to a healthy one from container state alone. The certbot
# container records the outcome in certbot-status; __certbot_status.sh maps it to
# PASS/WARN/FAIL. A pending or terminal issuance (1/2) is a domain-lifecycle state
# the domain stack owns, so it warns without blocking config sync; only a status
# that disagrees with the filesystem (4) is a failure.
check_certbot_issuance() {
  local script="${REPO_ROOT}/scripts/__certbot_status.sh"
  if [[ ! -f "$script" ]]; then
    record_result "tls certificate" "PASS" "skipped (status helper absent)"
    return 0
  fi

  local out rc
  # WHY chained: a standalone assignment adopts the substitution's status, so a
  # non-zero one aborts the run under `set -e` before the case below can map it.
  out="$(bash "$script" 2>&1)" && rc=0 || rc=$?
  case "$rc" in
    0) record_result "tls certificate" "PASS" "${out##*: }" ;;
    1) record_result "tls certificate" "WARN" "${out##*: }" ;;
    2) record_result "tls certificate" "WARN" "${out##*: }" ;;
    3) record_result "tls certificate" "PASS" "skipped (domain stack not running)" ;;
    4) record_result "tls certificate" "FAIL" "${out##*: }" ;;
    *) record_result "tls certificate" "WARN" "status helper exited $rc" ;;
  esac
}

# ===========================================================================
# 12) Worker isolate sandbox probe — execute isolate, don't just inspect files
# ===========================================================================
# WHY a live probe: a worker image whose isolate setup is broken still builds,
# deploys and reports healthy — the failure only surfaces when a grading job
# asks for a sandbox. The probe therefore creates and destroys one empty
# sandbox in a throwaway container started from the exact image the worker
# stack deploys, granted the same privileges compose grants that service, so a
# PASS means the whole chain (setuid binary, isolate account, subuid ranges)
# works end to end. No submission runs and no host state is touched; a host
# with no worker image yet has nothing to probe and skips rather than fails.
check_isolate_sandbox() {
  if ! stack_includes "worker"; then
    record_result "isolate sandbox" "PASS" "skipped (--stack ${STACK})"
    return 0
  fi

  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    record_result "isolate sandbox" "PASS" "skipped (docker unavailable)"
    return 0
  fi

  local worker_image="ghcr.io/champyod/cms-docker-worker:${IMG_TAG:-major-admin-panel}"
  if ! docker image inspect "$worker_image" >/dev/null 2>&1; then
    record_result "isolate sandbox" "PASS" "skipped (worker image not built)"
    return 0
  fi

  local probe_timeout=30
  local out rc
  # WHY chained: a standalone assignment adopts the substitution's status, so a
  # non-zero probe would abort the run under `set -e` before rc is classified.
  out="$(timeout "$probe_timeout" docker run --rm --privileged --network none \
    "$worker_image" sh -c 'isolate --init && isolate --cleanup' 2>&1)" && rc=0 || rc=$?

  if [[ $rc -eq 0 ]]; then
    printf '[INFO] isolate sandbox probe passed: %s\n' "$worker_image"
    record_result "isolate sandbox" "PASS" "sandbox create+cleanup ok"
    return 0
  fi

  local last_line
  last_line="$(printf '%s\n' "$out" | tail -n 1)"
  printf '[FAIL] isolate sandbox probe failed (exit %s): %s\n' "$rc" "$last_line" >&2
  if [[ $rc -eq 124 ]]; then
    record_result "isolate sandbox" "FAIL" "probe timed out after ${probe_timeout}s"
  else
    record_result "isolate sandbox" "FAIL" "isolate exit ${rc}: ${last_line}"
  fi
}

# nginx size (52M, 100M) or a bare byte count, as both sides of this comparison are
# written by hand in config files. WHY the suffix matters: comparing the strings would
# put "100M" and "104857600" on either side of an inequality and warn about a limit that
# is actually the larger one.
nginx_size_to_bytes() {
  local raw="$1" number unit
  raw="$(printf '%s' "$raw" | tr '[:lower:]' '[:upper:]' | tr -d '[:space:]')"
  [[ "$raw" =~ ^([0-9]+)([KMG]?)$ ]] || return 1
  number="${BASH_REMATCH[1]}"
  unit="${BASH_REMATCH[2]}"
  case "$unit" in
    K) printf '%s' "$(( number * 1024 ))" ;;
    M) printf '%s' "$(( number * 1024 * 1024 ))" ;;
    G) printf '%s' "$(( number * 1024 * 1024 * 1024 ))" ;;
    *) printf '%s' "$number" ;;
  esac
}

# Whether the proxy will accept everything the panel is willing to send.
# WHY this is a warning and not a failure: the stack works, every smaller upload works,
# and only a batch between the two limits is refused — with nginx's bare 413, so the
# operator sees no explanation from the panel. It is a mismatch to reconcile, not a
# deployment that will not come up.
check_proxy_body_size() {
  local configured panel_expr panel_bytes proxy_bytes
  configured="${PROXY_MAX_BODY_SIZE:-}"
  if [[ -z "$configured" ]]; then
    record_result "proxy body size" "PASS" "PROXY_MAX_BODY_SIZE unset — the proxy default applies"
    return 0
  fi
  if ! proxy_bytes="$(nginx_size_to_bytes "$configured")"; then
    record_result "proxy body size" "WARN" "PROXY_MAX_BODY_SIZE=${configured} is not a size nginx understands"
    return 0
  fi
  # The panel's cap is a TypeScript constant, so it is read from the source rather than
  # restated here — a copy would drift and the warning would stop matching reality.
  panel_expr="$(sed -n 's/^const DEFAULT_UPLOAD_BYTES *= *\([0-9][0-9* ]*\);.*/\1/p' \
    "${REPO_ROOT}/admin-panel/src/lib/testcase-limits.ts" 2>/dev/null | head -1 | tr -d '[:space:]')"
  # WHY the factors are multiplied rather than concatenated: the source spells the cap
  # `50 * 1024 * 1024`, and treating those digits as one number yields 5010241024 — a cap
  # a thousand times too large, which turns every comparison into a false warning.
  local factor product=1
  if [[ "$panel_expr" =~ ^[0-9]+(\*[0-9]+)+$ ]]; then
    local IFS='*'
    for factor in $panel_expr; do
      product=$(( product * factor ))
    done
    panel_bytes="$product"
  elif [[ "$panel_expr" =~ ^[0-9]+$ ]]; then
    panel_bytes="$panel_expr"
  fi
  if [[ ! "$panel_bytes" =~ ^[0-9]+$ || "$panel_bytes" -le 0 ]]; then
    # The panel source is not where it was expected, so say the check did not run rather
    # than reporting a comparison that was never made.
    record_result "proxy body size" "PASS" "panel upload cap not readable — nothing to compare against"
    return 0
  fi
  if (( proxy_bytes >= panel_bytes )); then
    record_result "proxy body size" "PASS" "proxy ${configured} accepts the panel's ${panel_bytes}-byte upload cap"
  else
    record_result "proxy body size" "WARN" \
      "proxy ${configured} is below the panel's ${panel_bytes}-byte cap — uploads in that range fail as a bare nginx 413"
  fi
}

check_disk
check_docker
check_env
check_cms_toml
check_captcha
check_secret_perms
check_ports
check_worker_cgroup
check_monitor_backup_access
check_config_stale
check_proxy_body_size
check_certbot_issuance
check_isolate_sandbox

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
