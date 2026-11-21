#!/bin/bash

###############################################################################
# View CMS Service Status
# Author: CCYod
# Repository: https://github.com/champyod/cms-docker
###############################################################################

# Every stack is declared in the single unified docker-compose.yml and gated by
# profiles, so each section below names its own services instead of reading a
# per-stack file. Containers are matched on the compose *service* label: the label
# is independent of the project name — the worker fleet runs in per-shard projects
# (cw<s>) that a project filter never sees — and of the file a container was
# started from. The wanted list is comma separated with no leading or trailing
# comma, which is what the label match below wraps in commas; a stray one would
# also match an unlabelled container (empty label).
stack_containers() { # compose file <service> ...
  local compose_file="$1" services
  local -a name_filters=()
  local name
  shift
  local IFS=','
  services="$*"
  if [ -z "$services" ]; then
    echo "  (no services named for $compose_file)"
    return 0
  fi

  # Repeatable label filters are ANDed while repeatable name filters are ORed, so
  # collect this stack's names first and let docker render the table after that.
  while IFS= read -r name; do
    [ -n "$name" ] && name_filters+=(--filter "name=^${name//./\\.}$")
  done < <(docker ps --format '{{.Names}}\t{{.Label "com.docker.compose.service"}}' \
             | awk -F'\t' -v wanted=",${services}," 'index(wanted, "," $2 ",") { print $1 }')

  if [ "${#name_filters[@]}" -eq 0 ]; then
    echo "  (none running)"
    return 0
  fi

  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' "${name_filters[@]}"
}

echo "==================================================================="
echo "                    CMS Services Status"
echo "==================================================================="
echo ""

echo "Core Services:"
stack_containers docker-compose.yml database log-service resource-service scoring-service checker-service
echo ""

echo "Admin Services:"
stack_containers docker-compose.yml admin-panel-next admin-web-server ranking-web-server
echo ""

echo "Contest Services:"
stack_containers docker-compose.yml evaluation-service proxy-service contest-web-server nginx-proxy
echo ""

echo "Worker Services:"
stack_containers docker-compose.yml worker
echo ""

echo "Monitor Services:"
stack_containers docker-compose.yml monitor
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
