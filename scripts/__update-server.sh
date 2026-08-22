#!/bin/bash
set -euo pipefail

# Change directory to the project root
cd "$(dirname "$0")/.."

log()  { printf '%s [UPDATE] %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"; }
warn() { printf '%s [UPDATE][WARN] %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*" >&2; }
die()  { warn "ERROR: $*"; exit 1; }

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RECORD_FILE="/tmp/cms-update-${TIMESTAMP}.txt"
DB_HEALTH_TIMEOUT=120

log "Starting non-interactive server update..."

# ---------------------------------------------------------------------------
# Pre-update record: old git HEAD + running image digests (manual rollback ref)
# ---------------------------------------------------------------------------
record_pre_update_state() {
    local git_head image_id image_ref digests cname
    git_head="$(git rev-parse HEAD 2>/dev/null || echo 'not-a-git-repo')"
    {
        echo "# CMS pre-update state — $(date +'%Y-%m-%d %H:%M:%S')"
        echo "git_head=${git_head}"
        echo "# Manual rollback: git checkout <git_head>, re-pull images by the"
        echo "# repo_digests below, pin them in the -img compose overrides, re-up."
    } > "$RECORD_FILE"
    while IFS= read -r cname; do
        [ -n "$cname" ] || continue
        image_id="$(docker inspect --format '{{.Image}}' "$cname" 2>/dev/null || echo unknown)"
        image_ref="$(docker inspect --format '{{.Config.Image}}' "$cname" 2>/dev/null || echo unknown)"
        digests="$(docker image inspect --format '{{join .RepoDigests ","}}' "$image_id" 2>/dev/null || echo unknown)"
        printf 'container=%s image_ref=%s image_id=%s repo_digests=%s\n' \
            "$cname" "$image_ref" "$image_id" "${digests:-unknown}" >> "$RECORD_FILE"
    done < <(docker ps -a --format '{{.Names}}' | grep '^cms-' || true)
    log "Pre-update state recorded to ${RECORD_FILE}"
}

record_pre_update_state

# ---------------------------------------------------------------------------
# (a) Pull latest code (+ submodules when present)
# ---------------------------------------------------------------------------
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    log "Pulling latest code..."
    git pull --ff-only || die "git pull failed; resolve manually and re-run."
    if [ -f .gitmodules ]; then
        log "Updating git submodules..."
        git submodule update --init --recursive || die "git submodule update failed."
    fi
else
    warn "Not a git repository; skipping code pull."
fi

# ---------------------------------------------------------------------------
# (b) Regenerate environment files so new variables land
# ---------------------------------------------------------------------------
log "Regenerating environment files (make env)..."
make env || die "make env failed."

# Deployment type must be detected AFTER env regeneration (branch switch may change it)
DEPLOY_TYPE="$(grep -E '^DEPLOYMENT_TYPE=' .env.admin 2>/dev/null | tail -n1 | cut -d '=' -f2 | cut -d '#' -f1 | tr -d '[:space:]' | tr -d '\"' | tr -d "'" || true)"
if [ -z "$DEPLOY_TYPE" ]; then
    DEPLOY_TYPE="$(grep -E '^DEPLOYMENT_TYPE=' .env 2>/dev/null | tail -n1 | cut -d '=' -f2 | cut -d '#' -f1 | tr -d '[:space:]' | tr -d '\"' | tr -d "'" || true)"
fi
DEPLOY_TYPE="${DEPLOY_TYPE:-img}"
log "Detected deployment type: ${DEPLOY_TYPE}"

# ---------------------------------------------------------------------------
# (c) Preflight checks — abort cleanly before touching running services
# ---------------------------------------------------------------------------
PREFLIGHT_SCRIPT="scripts/preflight.sh"
if [ ! -x "$PREFLIGHT_SCRIPT" ]; then
    die "scripts/preflight.sh not found or not executable; refusing to update."
fi
log "Running preflight checks..."
"$PREFLIGHT_SCRIPT" all || die "Preflight failed; aborting update cleanly."

# ---------------------------------------------------------------------------
# (d) Safety backup before mutating anything
# ---------------------------------------------------------------------------
BACKUP_SCRIPT="__backup.sh"
if [ -x "$BACKUP_SCRIPT" ]; then
    log "Running safety backup..."
    "$BACKUP_SCRIPT" || die "Backup failed; aborting update."
else
    warn "__backup.sh missing or not executable — SKIPPING SAFETY BACKUP."
    warn "Continuing WITHOUT a fresh backup. Consider Ctrl+C now."
fi

# ---------------------------------------------------------------------------
# (e) Stack detection + pull/up (preserved behavior)
# ---------------------------------------------------------------------------
container_exists() {
    local pattern="$1"
    docker ps -a --format '{{.Names}}' | grep -Eq "$pattern"
}

HAS_CORE=false
HAS_ADMIN=false
HAS_CONTEST=false
HAS_WORKER=false
HAS_INFRA=false

if container_exists '^cms-(database|log-service|resource-service|evaluation-service|scoring-service|proxy-service|checker-service)$'; then
    HAS_CORE=true
fi
if container_exists '^cms-(admin-panel-next|admin-web-server|ranking-web-server)$'; then
    HAS_ADMIN=true
fi
if container_exists '^cms-contest-web-server($|-)'; then
    HAS_CONTEST=true
fi
if container_exists '^cms-worker($|-)'; then
    HAS_WORKER=true
fi
if container_exists '^cms-monitor$'; then
    HAS_INFRA=true
fi

if [ "$HAS_CORE" = false ] && [ "$HAS_ADMIN" = false ] && [ "$HAS_CONTEST" = false ] && [ "$HAS_WORKER" = false ] && [ "$HAS_INFRA" = false ]; then
    log "No known CMS containers detected, falling back to full update path."
    HAS_CORE=true
    HAS_ADMIN=true
    HAS_CONTEST=true
    HAS_WORKER=true
    HAS_INFRA=true
fi

log "Detected active stacks: core=$HAS_CORE admin=$HAS_ADMIN contest=$HAS_CONTEST worker=$HAS_WORKER infra=$HAS_INFRA"

update_worker_shards() {
    local mode="$1" shard_name idx env_file
    local shard_count
    shard_count="$(docker ps -a --format '{{.Names}}' | grep -c '^cms-worker-[0-9]\+$' || true)"
    shard_count="${shard_count:-0}"
    if [ "$shard_count" -gt 0 ]; then
        log "Updating $shard_count worker shard(s)..."
        for shard_name in $(docker ps -a --format '{{.Names}}' | grep '^cms-worker-[0-9]\+$'); do
            idx=${shard_name#cms-worker-}
            env_file="workers/.env.worker.instance$idx"
            if [ -f "$env_file" ]; then
                log "Restarting shard $idx..."
                if [ "$mode" = "img" ]; then
                    docker compose --env-file "$env_file" -p "cms-worker-$idx" -f docker-compose.worker.yml -f docker-compose.worker.img.yml up -d --no-build
                else
                    log "Restarting shard $idx (source build)..."
                    docker compose --env-file "$env_file" -p "cms-worker-$idx" -f docker-compose.worker.yml up -d --build
                fi
            fi
        done
    elif [ "$mode" = "img" ]; then
        make worker-img
    else
        make worker
    fi
}

# Pull images
if [ "$DEPLOY_TYPE" = "img" ]; then
    log "Pulling latest images for active stacks..."
    [ "$HAS_CORE" = true ] && make pull-core
    [ "$HAS_ADMIN" = true ] && make pull-admin
    [ "$HAS_CONTEST" = true ] && make pull-contest
    [ "$HAS_WORKER" = true ] && make pull-worker
    [ "$HAS_INFRA" = true ] && make pull-infra
fi

# Restart services based on type
log "Restarting services..."
if [ "$DEPLOY_TYPE" = "img" ]; then
    [ "$HAS_CORE" = true ] && make core-img
    [ "$HAS_INFRA" = true ] && make infra-img
    [ "$HAS_ADMIN" = true ] && make admin-img
    [ "$HAS_CONTEST" = true ] && make contest-img
    [ "$HAS_WORKER" = true ] && update_worker_shards img
else
    [ "$HAS_CORE" = true ] && make core
    [ "$HAS_INFRA" = true ] && make infra
    [ "$HAS_ADMIN" = true ] && make admin
    [ "$HAS_CONTEST" = true ] && make contest
    [ "$HAS_WORKER" = true ] && update_worker_shards src
fi

# Sync DB schema
log "Syncing database schema..."
make cms-init || die "make cms-init failed."
make prisma-sync || die "make prisma-sync failed."

# ---------------------------------------------------------------------------
# (f) Post-update verification
# ---------------------------------------------------------------------------
read_env_port() {
    local file="$1" key="$2" default_value="$3" value
    value="$(grep -E "^${key}=" "$file" 2>/dev/null | head -n 1 | cut -d '=' -f2- | cut -d '#' -f1 | tr -d '[:space:]' | tr -d '\"' | tr -d "'" || true)"
    printf '%s' "${value:-$default_value}"
}

read_contest_port() {
    local file="$1" value
    value="$(grep -E '^CONTEST_LISTEN_PORT=' "$file" 2>/dev/null | head -n 1 | cut -d '=' -f2- | cut -d '#' -f1 | tr -d '[:space:]' | tr -d '\"' | tr -d "'" || true)"
    if [ -z "$value" ]; then
        value="$(grep -E '^ACTIVE_CONTEST_PORT=' "$file" 2>/dev/null | head -n 1 | cut -d '=' -f2- | cut -d '#' -f1 | tr -d '[:space:]' | tr -d '\"' | tr -d "'" || true)"
    fi
    printf '%s' "${value:-8888}"
}

wait_database_healthy() {
    local waited=0 status
    while [ "$waited" -lt "$DB_HEALTH_TIMEOUT" ]; do
        status="$(docker inspect --format '{{.State.Health.Status}}' cms-database 2>/dev/null || echo missing)"
        if [ "$status" = "healthy" ]; then
            return 0
        fi
        sleep 5
        waited=$((waited + 5))
    done
    warn "cms-database health: last status=${status}"
    return 1
}

http_ok() {
    local url="$1"
    curl -fsS -o /dev/null --max-time 10 "$url"
}

DB_RESULT="SKIP"
ADMIN_RESULT="SKIP"
CONTEST_RESULT="SKIP"

if docker inspect cms-database >/dev/null 2>&1; then
    log "Waiting for cms-database to become healthy (max ${DB_HEALTH_TIMEOUT}s)..."
    if wait_database_healthy; then DB_RESULT="PASS"; else DB_RESULT="FAIL"; fi
else
    log "cms-database not present; skipping DB health check."
fi

if [ "$HAS_ADMIN" = true ]; then
    ADMIN_PORT="$(read_env_port .env.admin ADMIN_NEXT_PORT_EXTERNAL 8891)"
    log "Checking admin panel on http://127.0.0.1:${ADMIN_PORT}/ ..."
    if http_ok "http://127.0.0.1:${ADMIN_PORT}/"; then ADMIN_RESULT="PASS"; else ADMIN_RESULT="FAIL"; fi
fi

if [ "$HAS_CONTEST" = true ]; then
    CONTEST_PORT="$(read_contest_port .env.contest)"
    log "Checking contest interface on http://127.0.0.1:${CONTEST_PORT}/ ..."
    if http_ok "http://127.0.0.1:${CONTEST_PORT}/"; then CONTEST_RESULT="PASS"; else CONTEST_RESULT="FAIL"; fi
fi

echo ""
log "===== POST-UPDATE SUMMARY (deployment type: ${DEPLOY_TYPE}) ====="
log "Database health : ${DB_RESULT}"
log "Admin panel     : ${ADMIN_RESULT} (port ${ADMIN_PORT:-n/a})"
log "Contest web     : ${CONTEST_RESULT} (port ${CONTEST_PORT:-n/a})"
echo ""

if [ "$DB_RESULT" = "FAIL" ] || [ "$ADMIN_RESULT" = "FAIL" ] || [ "$CONTEST_RESULT" = "FAIL" ]; then
    cat >&2 <<EOF
================================================================
 UPDATE VERIFICATION FAILED — manual rollback required
================================================================
No automatic rollback was performed. Previous state was recorded
in: ${RECORD_FILE}

Manual rollback steps:
  1. Review the record:
       cat ${RECORD_FILE}
  2. Restore the previous code version:
       git checkout <git_head value from the record>
  3. Restore previous images using the recorded repo_digests, e.g.:
       docker pull ghcr.io/<owner>/<image>@<old repo_digest>
     then pin that digest in the matching docker-compose.*.img.yml
     "image:" entries (or check out the old commit and rebuild).
  4. Bring stacks back up for every detected stack:
       make core-img infra-img admin-img contest-img worker-img
  5. Re-run scripts/update-server.sh once the cause is fixed.
================================================================
EOF
    exit 1
fi

log "Update completed successfully."
