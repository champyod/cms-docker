#!/bin/bash

###############################################################################
# Stop All CMS Services
# Author: CCYod
# Repository: https://github.com/champyod/cms-docker
###############################################################################

echo "Stopping all CMS services..."

# Stop all compose projects
docker compose -f docker-compose.core.yml down
docker compose -f docker-compose.admin.yml down
docker compose -f docker-compose.contest.yml down
docker compose -f docker-compose.worker.yml down

# Stop any additional worker instances
for i in {0..15}; do
    docker compose -p cms-worker-$i down 2>/dev/null
done

echo "All CMS services stopped."
echo ""
echo "To remove volumes (WARNING: deletes all data):"
echo "  docker volume rm cms-database-data cms-logs cms-cache cms-data"
