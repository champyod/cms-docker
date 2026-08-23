#!/usr/bin/env bash
set -euo pipefail
# scripts/smoke-test.sh — smoke test for CMS Docker unified compose.
# See header usage for contract.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"

# --- defensive source of common.sh (optional) ---
if [[ -f "${SCRIPT_DIR}/__lib/common.sh" ]]; then
  # shellcheck source=lib/common.sh
  source "${SCRIPT_DIR}/__lib/common.sh"
else
  # Fallback definitions when lib absent
  DISK_FLOOR_GB=3
  DISK_WARN_GB=5
  log_info() { printf '[INFO] %s\n' "$*"; }
  log_warn() { printf '[WARN] %s\n' "$*" >&2; }
  log_die() { local m="${1:-fatal}"; local c="${2:-1}"; printf '[FAIL] %s\n' "$m" >&2; exit "$c"; }
  require_disk_free_gb() {
    local tp="${1:?path}"; local floor="${2:-$DISK_FLOOR_GB}"; local warn="${3:-$DISK_WARN_GB}"
    local raw avail
    raw=$(df -BG --output=avail "$tp" 2>/dev/null | tail -n 1) || log_die "unable to determine disk space for: $tp" 2
    raw=$(printf '%s' "$raw" | tr -d '[:space:]'); avail="${raw%G}"; avail="${avail%%.*}"
    [[ "$avail" =~ ^[0-9]+$ ]] || log_die "unable to parse disk space value: $raw" 2
    (( avail < floor )) && log_die "disk space ${avail}G < floor ${floor}G at ${tp}" 2
    if (( avail < warn )); then log_warn "disk space low: ${avail}G < warn ${warn}G at ${tp}"; else log_info "disk space OK: ${avail}G available at ${tp}"; fi
  }
  is_default_secret() {
    local v="${1:-}"; [[ -z "$v" ]] && return 0
    case "$v" in cmspassword|usern4me|passw0rd|8e045a51e4b102ea803c06f92841a1fb|DEFAULT_SECRET_KEY) return 0;; esac
    [[ "$v" == CHANGE_ME* ]] && return 0
    [[ "$v" == YOUR_* ]] && return 0
    [[ "$v" == *PASSWORD_HERE* ]] && return 0
    return 1
  }
fi

# ---------------------------------------------------------------------------
# Defaults / arg parsing
# ---------------------------------------------------------------------------
MODE=""
STACKS="core,admin"
KEEP=0
DRY_RUN=0

print_usage() {
  cat <<'USAGE'
Usage: smoke-test.sh [--mode img|src] [--stacks core,admin,contest] [--keep] [--dry-run] [-h]
  --mode    img (GHCR) or src (build). Default: DEPLOYMENT_TYPE from .env.admin else img.
  --stacks  comma-separated subset of {core,admin,contest,worker,monitor}. Default: core,admin.
  --keep    do not teardown at end (implies SMOKE_KEEP_UP=1 handling).
  --dry-run print planned steps without executing.
  -h,--help show this help.
Environment:
  IMG_TAG            image tag (default major-admin-panel)
  SMOKE_KEEP_UP=1    keep stack up on failure (overrides teardown)
  ISOLATE_CGROUP_CONTROL=0  passed through for worker stack (real isolate needs host cgroup setup)
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) [[ $# -ge 2 ]] || log_die "missing value for --mode" 2; MODE="$2"; shift 2 ;;
    --mode=*) MODE="${1#--mode=}"; shift ;;
    --stacks) [[ $# -ge 2 ]] || log_die "missing value for --stacks" 2; STACKS="$2"; shift 2 ;;
    --stacks=*) STACKS="${1#--stacks=}"; shift ;;
    --keep) KEEP=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) print_usage; exit 0 ;;
    --) shift; break ;;
    -*) printf '[FAIL] unknown option: %s\n' "$1" >&2; print_usage >&2; exit 2 ;;
    *) printf '[FAIL] unexpected arg: %s\n' "$1" >&2; print_usage >&2; exit 2 ;;
  esac
done

# Validate mode
if [[ -n "$MODE" && "$MODE" != "img" && "$MODE" != "src" ]]; then
  log_die "invalid --mode: $MODE (expected img|src)" 2
fi

# Resolve default mode from .env.admin DEPLOYMENT_TYPE if not given
if [[ -z "$MODE" ]]; then
  if [[ -f "${REPO_ROOT}/.env.admin" ]]; then
    MODE=$(grep -E '^DEPLOYMENT_TYPE=' "${REPO_ROOT}/.env.admin" | tail -n1 | cut -d= -f2 | tr -d '[:space:]' | tr -d '"' | tr -d "'" || true)
  fi
  if [[ -z "$MODE" && -f "${REPO_ROOT}/.env" ]]; then
    MODE=$(grep -E '^DEPLOYMENT_TYPE=' "${REPO_ROOT}/.env" | tail -n1 | cut -d= -f2 | cut -d'#' -f1 | tr -d '[:space:]' | tr -d '"' | tr -d "'" || true)
  fi
  [[ -z "$MODE" ]] && MODE="img"
fi
# Normalize
MODE=$(printf '%s' "$MODE" | tr '[:upper:]' '[:lower:]' | xargs)

# Parse stacks
IFS=',' read -ra STACK_ARR <<< "$STACKS"
# trim + validate
VALID_STACKS="core admin contest worker monitor"
declare -a STACKS_NORM=()
for s in "${STACK_ARR[@]}"; do
  s=$(printf '%s' "$s" | xargs | tr '[:upper:]' '[:lower:]')
  [[ -z "$s" ]] && continue
  if ! printf '%s' "$VALID_STACKS" | grep -qw "$s"; then
    log_die "invalid stack in --stacks: $s (expected core|admin|contest|worker|monitor)" 2
  fi
  # de-dup
  skip=0; for e in "${STACKS_NORM[@]}"; do [[ "$e" == "$s" ]] && skip=1; done; [[ $skip -eq 1 ]] && continue
  STACKS_NORM+=("$s")
done
if [[ ${#STACKS_NORM[@]} -eq 0 ]]; then
  log_die "--stacks yielded no valid stacks" 2
fi

# IMG_TAG
IMG_TAG="${IMG_TAG:-major-admin-panel}"
# Also load from .env if present (COMPOSE will, but we need for image inspect)
if [[ -f "${REPO_ROOT}/.env" ]]; then
  _tag_from_env=$(grep -E '^IMG_TAG=' "${REPO_ROOT}/.env" | tail -n1 | cut -d= -f2 | tr -d '[:space:]' | tr -d '"' | tr -d "'" || true)
  # Prefer explicit env var; only use .env if IMG_TAG still default and .env has one
  if [[ "$IMG_TAG" == "major-admin-panel" && -n "$_tag_from_env" ]]; then IMG_TAG="$_tag_from_env"; fi
fi

SMOKE_KEEP_UP="${SMOKE_KEEP_UP:-0}"
[[ "$KEEP" -eq 1 ]] && SMOKE_KEEP_UP=1

# Compose profile args for requested stacks
compose_profiles_args() {
  local out=""
  for s in "${STACKS_NORM[@]}"; do out+=" --profile $s"; done
  printf '%s' "$out"
}

# Result matrix storage
declare -a MATRIX_SVC=()
declare -a MATRIX_CHECK=()
declare -a MATRIX_RESULT=()
declare -a MATRIX_DUR=()

record_matrix() {
  MATRIX_SVC+=("$1"); MATRIX_CHECK+=("$2"); MATRIX_RESULT+=("$3"); MATRIX_DUR+=("$4")
}

print_matrix() {
  printf '\n'
  printf '┌──────────────────────────┬──────────────────┬────────┬──────────┐\n'
  printf '│ %-24s │ %-16s │ %-6s │ %-8s │\n' "service" "check type" "result" "duration"
  printf '├──────────────────────────┼──────────────────┼────────┼──────────┤\n'
  local i
  for i in "${!MATRIX_SVC[@]}"; do
    printf '│ %-24s │ %-16s │ %-6s │ %8s │\n' "${MATRIX_SVC[$i]}" "${MATRIX_CHECK[$i]}" "${MATRIX_RESULT[$i]}" "${MATRIX_DUR[$i]}"
  done
  printf '└──────────────────────────┴──────────────────┴────────┴──────────┘\n'
}

# Failure artifact handling
FAIL_TS=""
FAIL_DIR=""
ensure_fail_dir() {
  if [[ -z "$FAIL_DIR" ]]; then
    FAIL_TS=$(date +%Y%m%d-%H%M%S)
    FAIL_DIR="/tmp/cms-smoke-${FAIL_TS}"
    mkdir -p "$FAIL_DIR" 2>/dev/null || true
  fi
}

dump_logs() {
  local container="$1"
  ensure_fail_dir
  local out="${FAIL_DIR}/${container}.log"
  if command -v docker >/dev/null 2>&1; then
    docker logs --tail 100 "$container" > "$out" 2>&1 || printf 'failed to get logs for %s\n' "$container" > "$out"
    log_warn "dumped logs for ${container} -> ${out}"
  fi
}

teardown() {
  if [[ "$SMOKE_KEEP_UP" == "1" || "$KEEP" -eq 1 ]]; then
    log_info "teardown skipped (--keep / SMOKE_KEEP_UP=1); stack left up"
    return 0
  fi
  log_info "teardown: compose down for profiles: ${STACKS_NORM[*]} (without -v, volumes preserved)"
  local pargs
  pargs=$(compose_profiles_args)
  # shellcheck disable=SC2086
  docker compose -f "$COMPOSE_FILE" $pargs down --remove-orphans 2>&1 || log_warn "compose down returned non-zero (ignored)"
  log_info "teardown complete (volumes preserved; reclaimed note: containers/networks removed, images/volumes kept)"
}

on_fail_teardown() {
  if [[ "$SMOKE_KEEP_UP" == "1" ]]; then
    log_warn "failure path: keeping stack up (SMOKE_KEEP_UP=1)"
  else
    # Dump attempt already done by caller; now down
    local pargs
    pargs=$(compose_profiles_args)
    # shellcheck disable=SC2086
    docker compose -f "$COMPOSE_FILE" $pargs down --remove-orphans 2>&1 || true
    log_info "stack torn down after failure (SMOKE_KEEP_UP != 1)"
  fi
}

# Wait helpers
wait_healthy() {
  local container="$1"; local timeout_s="$2"
  local start elapsed status
  start=$(date +%s)
  while true; do
    elapsed=$(( $(date +%s) - start ))
    if (( elapsed >= timeout_s )); then
      printf '[FAIL] wait_healthy %s timed out after %ds\n' "$container" "$timeout_s" >&2
      return 1
    fi
    # Inspect health status; if no healthcheck, use running state
    local health
    health=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container" 2>/dev/null || echo "missing")
    if [[ "$health" == "healthy" ]]; then
      log_info "wait_healthy ${container}: healthy after ${elapsed}s"
      return 0
    fi
    if [[ "$health" == "no-healthcheck" ]]; then
      local running
      running=$(docker inspect --format='{{.State.Running}}' "$container" 2>/dev/null || echo "false")
      if [[ "$running" == "true" ]]; then
        log_info "wait_healthy ${container}: running (no healthcheck) after ${elapsed}s"
        return 0
      fi
    fi
    if [[ "$health" == "missing" ]]; then
      # container not yet created
      :
    fi
    # Check if container is in unhealthy / exited
    local state_status
    state_status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "unknown")
    if [[ "$state_status" == "exited" || "$state_status" == "dead" ]]; then
      printf '[FAIL] container %s is %s (health=%s)\n' "$container" "$state_status" "$health" >&2
      return 1
    fi
    sleep 5
  done
}

curl_wait() {
  local url="$1"; local timeout_s="$2"
  local start elapsed code
  start=$(date +%s)
  while true; do
    elapsed=$(( $(date +%s) - start ))
    if (( elapsed >= timeout_s )); then
      printf '[FAIL] curl_wait %s timed out after %ds\n' "$url" "$timeout_s" >&2
      return 1
    fi
    code=$(curl -fsS -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo "000")
    if [[ "$code" =~ ^[23][0-9][0-9]$ ]]; then
      log_info "curl_wait ${url}: HTTP ${code} after ${elapsed}s"
      return 0
    fi
    sleep 5
  done
}

# Resolve contest port env name by inspecting compose file at runtime (do not hardcode wrong name)
resolve_contest_port() {
  # Prefer CONTEST_PORT_EXTERNAL if present, else ACTIVE_CONTEST_PORT, else default 8888
  local val=""
  # Check compose file for env var names used in contest-web-server ports
  if grep -q 'CONTEST_PORT_EXTERNAL' "$COMPOSE_FILE" 2>/dev/null; then
    val="${CONTEST_PORT_EXTERNAL:-}"
    [[ -z "$val" ]] && val="${ACTIVE_CONTEST_PORT:-}"
    [[ -z "$val" ]] && val="8888"
    printf '%s' "$val"
    return 0
  fi
  if grep -q 'ACTIVE_CONTEST_PORT' "$COMPOSE_FILE" 2>/dev/null; then
    val="${ACTIVE_CONTEST_PORT:-8888}"
    printf '%s' "$val"
    return 0
  fi
  # Fallback scan: discover ${...PORT...} in contest ports line
  local discovered
  discovered=$(grep -A2 'contest-web-server:' "$COMPOSE_FILE" | grep -oE '\$\{[A-Z_]*PORT[^}]*\}' | head -n1 | tr -d '${}:-' || true)
  if [[ -n "$discovered" ]]; then
    # indirect
    local v="${!discovered:-8888}"
    printf '%s' "$v"
    return 0
  fi
  printf '8888'
}

# ---------------------------------------------------------------------------
# DRY-RUN: print planned steps
# ---------------------------------------------------------------------------
do_dry_run() {
  local pargs; pargs=$(compose_profiles_args)
  cat <<DRY
[DRY-RUN] smoke-test plan
  mode: ${MODE}
  stacks: ${STACKS_NORM[*]}
  img_tag: ${IMG_TAG}
  compose: ${COMPOSE_FILE}
  keep: ${KEEP} (SMOKE_KEEP_UP=${SMOKE_KEEP_UP})
  profiles args: ${pargs}
Steps:
  1. Disk guard: require_disk_free_gb ${REPO_ROOT} (floor 3G, warn 5G)
  2. Preflight env: check .env exists else exit 2; validate POSTGRES_PASSWORD/AUTH_SECRET/SECRET_KEY non-empty + not placeholder
  3. Ensure images: mode=${MODE} -> $(if [[ "$MODE" == "img" ]]; then echo "docker compose -f docker-compose.yml${pargs} pull || true; docker image inspect ghcr.io/champyod/cms-docker-core:\${IMG_TAG} else fall back to build"; else echo "docker compose -f docker-compose.yml${pargs} build"; fi); log image sizes (docker images); re-check disk after pull
  4. Up sequence:
     a. docker compose -f docker-compose.yml --profile core up -d database -> wait_healthy cms-database 90
     b. remaining core: up log/resource/scoring/checker -> wait_healthy each 120
     c. admin: up admin profile (if in stacks) -> curl_wait 127.0.0.1:\${ADMIN_NEXT_PORT_EXTERNAL:-8891}, :\${ADMIN_PORT_EXTERNAL:-8889}, ranking :\${RANKING_PORT_EXTERNAL:-8890} (120s each)
     d. contest: up contest profile (if in stacks) -> curl_wait :\$(resolve_contest_port) via compose-discovered env var (120s)
     Note: worker/monitor never run by default; --stacks worker includes ISOLATE_CGROUP_CONTROL=0 override (real isolate needs host cgroup setup via scripts/__worker_cgroup_setup.sh)
  5. Result matrix: service | check type | result | duration
  6. Teardown: compose down for requested profiles WITHOUT -v (preserve volumes); on failure dump docker logs --tail 100 to /tmp/cms-smoke-<ts>/; keep up only if SMOKE_KEEP_UP=1
  7. Exit: 0 all-green, 1 failures, 2 preconditions
DRY
}

if [[ "$DRY_RUN" -eq 1 ]]; then
  do_dry_run
  exit 0
fi

# ===========================================================================
# 1. Disk guard FIRST
# ===========================================================================
require_disk_free_gb "$REPO_ROOT"

# ===========================================================================
# 2. Preflight env sanity
# ===========================================================================
if [[ ! -f "${REPO_ROOT}/.env" ]]; then
  printf '[FAIL] .env not found at %s — run: make env\n' "${REPO_ROOT}/.env" >&2
  exit 2
fi

# Load .env for checks (export)
set -a
# shellcheck disable=SC1090
source "${REPO_ROOT}/.env" 2>/dev/null || true
set +a

# Also source .env.admin/.env.contest directly if .env missing parts (for placeholder detection)
for _ef in "${REPO_ROOT}/.env.admin" "${REPO_ROOT}/.env.contest" "${REPO_ROOT}/.env.core"; do
  if [[ -f "$_ef" ]]; then
    set -a; source "$_ef" 2>/dev/null || true; set +a
  fi
done

env_preflight_fail=0
check_secret_var() {
  local var_name="$1"
  local val="${!var_name:-}"
  if [[ -z "$val" ]]; then
    printf '[FAIL] %s is empty or unset (check .env / .env.*)\n' "$var_name" >&2
    return 1
  fi
  if is_default_secret "$val"; then
    printf '[FAIL] %s is a default/placeholder value: %s\n' "$var_name" "$val" >&2
    return 1
  fi
  return 0
}

# Required: POSTGRES_PASSWORD, AUTH_SECRET, SECRET_KEY
# Only enforce stacks that are requested? Spec says preflight env sanity: POSTGRES_PASSWORD/AUTH_SECRET/SECRET_KEY non-empty + not placeholder patterns (always)
# We enforce all three regardless of stacks, but allow missing SECRET_KEY if contest not in stacks as WARN? Spec says preflight checks them — treat as hard fail.
for _v in POSTGRES_PASSWORD AUTH_SECRET SECRET_KEY; do
  if ! check_secret_var "$_v"; then
    env_preflight_fail=1
  fi
done

if [[ "$env_preflight_fail" -ne 0 ]]; then
  # List which file defines what for hint
  printf '[FAIL] preflight env sanity failed — fix .env.* then run: make env\n' >&2
  exit 2
fi
log_info "preflight env sanity: POSTGRES_PASSWORD/AUTH_SECRET/SECRET_KEY OK"

# ===========================================================================
# 3. Ensure images
# ===========================================================================
COMPOSE_PROFILES_ARGS=$(compose_profiles_args)

log_image_sizes() {
  if command -v docker >/dev/null 2>&1; then
    docker images --format 'table {{.Repository}}:{{.Tag}}\t{{.Size}}' 2>/dev/null | head -n 30 || true
  fi
}

if [[ "$MODE" == "img" ]]; then
  log_info "ensure images: img mode — pulling (profiles:${STACKS_NORM[*]})"
  # shellcheck disable=SC2086
  docker compose -f "$COMPOSE_FILE" $COMPOSE_PROFILES_ARGS pull 2>&1 || true
  # Verify core image exists locally
  CORE_IMAGE="ghcr.io/champyod/cms-docker-core:${IMG_TAG}"
  if ! docker image inspect "$CORE_IMAGE" >/dev/null 2>&1; then
    log_warn "image ${CORE_IMAGE} not found locally after pull — falling back to build with explicit warning"
    require_disk_free_gb "$REPO_ROOT"
    # shellcheck disable=SC2086
    docker compose -f "$COMPOSE_FILE" $COMPOSE_PROFILES_ARGS build 2>&1 || log_die "fallback build failed for ${CORE_IMAGE}" 1
  else
    log_info "image ${CORE_IMAGE} present locally"
  fi
else
  log_info "ensure images: src mode — building (profiles:${STACKS_NORM[*]})"
  # shellcheck disable=SC2086
  docker compose -f "$COMPOSE_FILE" $COMPOSE_PROFILES_ARGS build 2>&1 || log_die "compose build failed" 1
fi

log_info "image sizes before proceeding:"
log_image_sizes

# Re-check disk after pull/build
require_disk_free_gb "$REPO_ROOT"

# ===========================================================================
# 4. Up sequence with per-service wait helpers
# ===========================================================================
# Track overall failure
SMOKE_FAILED=0

# Helper to run a check and record matrix
run_wait_healthy() {
  local container="$1"; local timeout_s="$2"
  local start end dur rc
  start=$(date +%s)
  if wait_healthy "$container" "$timeout_s"; then rc=0; else rc=1; fi
  end=$(date +%s); dur="${end}-${start}s"; dur="$((end - start))s"
  if [[ $rc -eq 0 ]]; then
    record_matrix "$container" "health" "PASS" "$dur"
  else
    record_matrix "$container" "health" "FAIL" "$dur"
    dump_logs "$container"
    SMOKE_FAILED=1
  fi
  return $rc
}

run_curl_wait() {
  local svc="$1"; local url="$2"; local timeout_s="$3"
  local start end dur rc
  start=$(date +%s)
  if curl_wait "$url" "$timeout_s"; then rc=0; else rc=1; fi
  end=$(date +%s); dur="$((end - start))s"
  if [[ $rc -eq 0 ]]; then
    record_matrix "$svc" "http" "PASS" "$dur"
  else
    record_matrix "$svc" "http" "FAIL" "$dur"
    # Try to dump logs of corresponding container if mappable
    local container_guess=""
    case "$svc" in
      admin-next) container_guess="cms-admin-panel-next" ;;
      admin-web) container_guess="cms-admin-web-server" ;;
      ranking) container_guess="cms-ranking-web-server" ;;
      contest) container_guess="cms-contest-web-server" ;;
    esac
    [[ -n "$container_guess" ]] && dump_logs "$container_guess"
    SMOKE_FAILED=1
  fi
  return $rc
}

# Failure handler mid-flow
fail_mid_flow() {
  local msg="$1"
  printf '[FAIL] %s\n' "$msg" >&2
  print_matrix
  on_fail_teardown
  exit 1
}

# a. up database only
log_info "up: database"
# shellcheck disable=SC2086
docker compose -f "$COMPOSE_FILE" --profile core up -d database 2>&1 || fail_mid_flow "compose up database failed"
if ! run_wait_healthy "cms-database" 90; then
  fail_mid_flow "cms-database failed to become healthy"
fi

# b. up remaining core profile (if core in stacks)
if printf '%s\n' "${STACKS_NORM[@]}" | grep -qx "core"; then
  log_info "up: remaining core services (log/resource/scoring/checker)"
  # Up everything in core profile (database already up, compose is idempotent)
  # shellcheck disable=SC2086
  docker compose -f "$COMPOSE_FILE" --profile core up -d 2>&1 || fail_mid_flow "compose up core failed"
  for svc in cms-log-service cms-resource-service cms-scoring-service cms-checker-service; do
    if ! run_wait_healthy "$svc" 120; then
      fail_mid_flow "${svc} failed to become healthy"
    fi
  done
else
  log_info "skip core remaining (not in --stacks)"
  for svc in cms-log-service cms-resource-service cms-scoring-service cms-checker-service; do
    record_matrix "$svc" "health" "SKIP" "0s"
  done
fi

# c. admin profile
if printf '%s\n' "${STACKS_NORM[@]}" | grep -qx "admin"; then
  log_info "up: admin profile"
  # shellcheck disable=SC2086
  docker compose -f "$COMPOSE_FILE" --profile admin up -d 2>&1 || fail_mid_flow "compose up admin failed"
  ADMIN_NEXT_PORT="${ADMIN_NEXT_PORT_EXTERNAL:-8891}"
  ADMIN_PORT="${ADMIN_PORT_EXTERNAL:-8889}"
  RANKING_PORT="${RANKING_PORT_EXTERNAL:-8890}"
  run_curl_wait "admin-next" "http://127.0.0.1:${ADMIN_NEXT_PORT}/" 120 || true
  run_curl_wait "admin-web" "http://127.0.0.1:${ADMIN_PORT}/" 120 || true
  run_curl_wait "ranking" "http://127.0.0.1:${RANKING_PORT}/" 120 || true
  if [[ "$SMOKE_FAILED" -ne 0 ]]; then
    # Don't exit immediately; let matrix collect but mark failure
    log_warn "admin checks had failures (see matrix)"
  fi
else
  log_info "skip admin (not in --stacks)"
  for svc in admin-next admin-web ranking; do record_matrix "$svc" "http" "SKIP" "0s"; done
fi

# d. contest profile
if printf '%s\n' "${STACKS_NORM[@]}" | grep -qx "contest"; then
  log_info "up: contest profile"
  # shellcheck disable=SC2086
  docker compose -f "$COMPOSE_FILE" --profile contest up -d 2>&1 || fail_mid_flow "compose up contest failed"
  CONTEST_PORT_VAL=$(resolve_contest_port)
  # Documented: read docker-compose.yml at runtime to discover env name — already done via resolve_contest_port
  run_curl_wait "contest" "http://127.0.0.1:${CONTEST_PORT_VAL}/" 120 || true
  if [[ "$SMOKE_FAILED" -ne 0 ]]; then
    log_warn "contest checks had failures (see matrix)"
  fi
else
  log_info "skip contest (not in --stacks)"
  record_matrix "contest" "http" "SKIP" "0s"
fi

# Worker/monitor explicit support
if printf '%s\n' "${STACKS_NORM[@]}" | grep -qx "worker"; then
  log_info "up: worker profile (ISOLATE_CGROUP_CONTROL=0 override; real isolate needs host cgroup setup via scripts/__worker_cgroup_setup.sh)"
  ISOLATE_CGROUP_CONTROL=0 docker compose -f "$COMPOSE_FILE" --profile worker up -d 2>&1 || fail_mid_flow "compose up worker failed"
  # Health check for worker container(s) — name is cms-worker-${WORKER_SHARD:-0}
  WORKER_SHARD_VAL="${WORKER_SHARD:-0}"
  run_wait_healthy "cms-worker-${WORKER_SHARD_VAL}" 120 || true
fi

if printf '%s\n' "${STACKS_NORM[@]}" | grep -qx "monitor"; then
  log_info "up: monitor profile"
  # shellcheck disable=SC2086
  docker compose -f "$COMPOSE_FILE" --profile monitor up -d 2>&1 || fail_mid_flow "compose up monitor failed"
  # Monitor has no HTTP endpoint; check container running
  run_wait_healthy "cms-monitor" 60 || true
fi

# ===========================================================================
# 5. Result matrix printed
# ===========================================================================
print_matrix

# Record artifact note if any failures dumped
if [[ -n "$FAIL_DIR" && -d "$FAIL_DIR" ]]; then
  log_warn "failure artifacts in ${FAIL_DIR}/ (docker logs --tail 100)"
fi

# ===========================================================================
# 6. Teardown (unless --keep)
# ===========================================================================
if [[ "$SMOKE_FAILED" -ne 0 ]]; then
  # On any failure mid-flow we already have dump; now handle keep vs down
  print_matrix
  on_fail_teardown
  exit 1
fi

# Success path teardown
teardown

# ===========================================================================
# 7. Exit codes
# ===========================================================================
exit 0
