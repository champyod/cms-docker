#!/bin/bash

###############################################################################
# View CMS Service Status
# Author: CCYod
# Repository: https://github.com/champyod/cms-docker
###############################################################################

echo "==================================================================="
echo "                    CMS Services Status"
echo "==================================================================="
echo ""

echo "Core Services:"
docker compose -f docker-compose.core.yml ps
echo ""

echo "Admin Services:"
docker compose -f docker-compose.admin.yml ps
echo ""

echo "Contest Services:"
docker compose -f docker-compose.contest.yml ps
echo ""

echo "Worker Services:"
docker compose -f docker-compose.worker.yml ps
echo ""

echo "==================================================================="
echo "                    Resource Usage"
echo "==================================================================="
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
echo ""

echo "==================================================================="
echo "                    Network Status"
echo "==================================================================="
docker network inspect cms-network --format '{{range .Containers}}{{.Name}}: {{.IPv4Address}}{{println}}{{end}}'
echo ""

echo "==================================================================="
echo "                    Volume Usage"
echo "==================================================================="
docker volume ls --filter name=cms
echo ""
docker system df -v | grep cms
