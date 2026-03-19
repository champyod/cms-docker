#!/bin/bash
set -e

# Change directory to the project root
cd "$(dirname "$0")/.."

# Log function
log() { echo -e "$(date +'%Y-%m-%d %H:%M:%S') [UPDATE] $1"; }

log "Starting non-interactive server update..."

# Detect deployment type (img or src) - defaults to img if not set
DEPLOY_TYPE=$(grep "^DEPLOYMENT_TYPE=" .env.admin 2>/dev/null | cut -d '=' -f2- || echo "img")
log "Detected deployment type: $DEPLOY_TYPE"

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
    
    if [ "$HAS_WORKER" = true ]; then
        # Check if we have multiple shards (project-based)
        SHARD_COUNT=$(docker ps -a --format '{{.Names}}' | grep -c '^cms-worker-[0-9]\+$' || echo 0)
        if [ "$SHARD_COUNT" -gt 0 ]; then
            log "Updating $SHARD_COUNT worker shard(s)..."
            # Get unique shard indices from container names
            for shard_name in $(docker ps -a --format '{{.Names}}' | grep '^cms-worker-[0-9]\+$'); do
                idx=${shard_name#cms-worker-}
                env_file="workers/.env.worker.instance$idx"
                if [ -f "$env_file" ]; then
                    log "Restarting shard $idx..."
                    docker compose --env-file "$env_file" -p "cms-worker-$idx" -f docker-compose.worker.yml -f docker-compose.worker.img.yml up -d --no-build
                fi
            done
        else
            make worker-img
        fi
    fi
else
    [ "$HAS_CORE" = true ] && make core
    [ "$HAS_INFRA" = true ] && make infra
    [ "$HAS_ADMIN" = true ] && make admin
    [ "$HAS_CONTEST" = true ] && make contest
    
    if [ "$HAS_WORKER" = true ]; then
        SHARD_COUNT=$(docker ps -a --format '{{.Names}}' | grep -c '^cms-worker-[0-9]\+$' || echo 0)
        if [ "$SHARD_COUNT" -gt 0 ]; then
            log "Updating $SHARD_COUNT worker shard(s)..."
            for shard_name in $(docker ps -a --format '{{.Names}}' | grep '^cms-worker-[0-9]\+$'); do
                idx=${shard_name#cms-worker-}
                env_file="workers/.env.worker.instance$idx"
                if [ -f "$env_file" ]; then
                    log "Restarting shard $idx (source build)..."
                    docker compose --env-file "$env_file" -p "cms-worker-$idx" -f docker-compose.worker.yml up -d --build
                fi
            done
        else
            make worker
        fi
    fi
fi

# Sync DB schema
log "Syncing database schema..."
make cms-init
make prisma-sync

log "Update completed successfully."
