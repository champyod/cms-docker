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

# Pull images
log "Pulling latest images..."
make pull

# Restart services based on type
log "Restarting services..."
if [ "$DEPLOY_TYPE" = "img" ]; then
    make core-img
    make infra-img
    make admin-img
    # Check if contests exist before starting
    if [ -f docker-compose.contests.generated.yml ] && grep -q "contest-web-server-" docker-compose.contests.generated.yml; then
        make contest-img
    fi
    # Check if worker exists
    if [ -f .env.worker ] || [ -f docker-compose.worker.yml ]; then
        make worker-img
    fi
else
    make core
    make infra
    make admin
    # Check if contests exist
    if [ -f docker-compose.contests.generated.yml ] && grep -q "contest-web-server-" docker-compose.contests.generated.yml; then
        make contest
    fi
    # Check if worker exists
    if [ -f .env.worker ] || [ -f docker-compose.worker.yml ]; then
        make worker
    fi
fi

# Sync DB schema
log "Syncing database schema..."
make cms-init
make prisma-sync

log "Update completed successfully."
