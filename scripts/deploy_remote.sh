#!/bin/bash
# Script to configure and deploy env files to remote server
# Usage: ./deploy_remote.sh [REMOTE_HOST] [REMOTE_USER] [REMOTE_PATH]

REMOTE_HOST=${1:-"100.86.134.126"}
REMOTE_USER=${2:-"ccyod"}
REMOTE_PATH=${3:-"/home/ccyod/cms-docker/"}

echo "Deploying to ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}..."

# 1. Create temporary remote env files
echo "Preparing configuration for remote host ${REMOTE_HOST}..."

# Core Env
cp .env.core .env.core.remote
sed -i "s/^PUBLIC_IP=.*/PUBLIC_IP=${REMOTE_HOST}/" .env.core.remote

# Worker Env
# Assuming the worker connects to the core on the SAME host for this specific request
# "as real running is on 100.86.134.126" implies single box deployment or core is there.
cp .env.worker .env.worker.remote
sed -i "s/^CORE_SERVICES_HOST=.*/CORE_SERVICES_HOST=${REMOTE_HOST}/" .env.worker.remote
# Ensure worker IP is also updated if needed, usually it binds to 0.0.0.0 inside docker
# but if we have specific settings, update them.

# Contest Env
cp .env.contest .env.contest.remote
sed -i "s/^PUBLIC_IP=.*/PUBLIC_IP=${REMOTE_HOST}/" .env.contest.remote
sed -i "s/^CONTEST_Listen_ADDRESS=.*/CONTEST_LISTEN_ADDRESS=0.0.0.0/" .env.contest.remote

# Admin Env
cp .env.admin .env.admin.remote
# Admin usually connects to DB via localhost if on same machine, or service name 'database'.
# Docker compose handles service names. 
# We only need to change external facing vars if any.

# 2. Copy files via SCP
echo "Copying files..."
scp .env.core.remote ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}.env.core
scp .env.worker.remote ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}.env.worker
scp .env.contest.remote ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}.env.contest
scp .env.admin.remote ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}.env.admin

# Cleanup
rm .env.core.remote .env.worker.remote .env.contest.remote .env.admin.remote

echo "Done! You may need to run 'make env' and 'docker compose up -d' on the remote server."
