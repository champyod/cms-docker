#!/bin/bash

###############################################################################
# View CMS Service Status
# Author: CCYod
# Repository: https://github.com/champyod/cms-docker
###############################################################################

# Each stack file only declares its own services, but `docker compose -f <file> ps`
# resolves containers by compose *project*: core/admin/contest share the
# directory-derived project, so all three sections printed the same list, and the
# worker fleet runs in per-shard projects (cw<s>) that such a project filter never
# sees. The compose service label is the only scope marker that is independent of
# both the project name and the file a container was started from.
stack_services() { # stack compose file -> comma separated service names
  local compose_file="$1" services
  # Profile-gated services (contest nginx-proxy) stay hidden unless a profile is
  # enabled, so ask for every profile; the second call covers compose CLIs that
  # predate the "*" wildcard.
  services="$(docker compose --profile '*' -f "$compose_file" config --services 2>/dev/null)"
  [ -n "$services" ] || services="$(docker compose -f "$compose_file" config --services 2>/dev/null)"
  printf '%s' "${services//$'\n'/,}"
}

stack_containers() { # stack compose file [service ...]
  local compose_file="$1" services
  local -a name_filters=()
  local name
  shift

  # A stack without a partial file of its own (monitor lives in
  # docker-compose.yml) names its services: that file declares every stack, so
  # reading its service list would repeat the tables printed above. The list is
  # comma separated with no leading or trailing comma, which is what the label
  # match below wraps in commas — a stray one would also match an unlabelled
  # container (empty label).
  if [ "$#" -gt 0 ]; then
    local IFS=','
    services="$*"
  else
    services="$(stack_services "$compose_file")"
  fi
  if [ -z "$services" ]; then
    echo "  (cannot read the service list of $compose_file)"
    return 0
  fi

  # Repeatable label filters are ANDed while repeatable name filters are ORed, and
  # worker container names embed the shard number, so match on the service label to
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
stack_containers docker-compose.core.yml
echo ""

echo "Admin Services:"
stack_containers docker-compose.admin.yml
echo ""

echo "Contest Services:"
stack_containers docker-compose.contest.yml
echo ""

echo "Worker Services:"
stack_containers docker-compose.worker.yml
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
