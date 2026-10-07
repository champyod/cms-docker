#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
action="${1:-}"
case "$action" in
  start|stop|restart) shift ;;
  *) echo 'Expected start, stop, or restart.' >&2; exit 1 ;;
esac
for shard in "$@"; do
  [[ "$shard" =~ ^[0-9]+$ ]] || { echo 'Invalid worker shard.' >&2; exit 1; }
done

# Reuse the fleet reader without deploy's seed_if_empty side effect or a second
# interpretation of WORKER_N, LOCAL flags, and per-shard defaults.
fleet="$(bash scripts/__worker_tui.sh list)"
containers=()
selected=()
while read -r shard host port scope rest; do
  [[ "$shard" =~ ^[0-9]+$ ]] || continue
  [ "$scope" = local ] || continue
  if [ "$#" -gt 0 ]; then
    wanted=0
    for target in "$@"; do
      [ "$target" != "$shard" ] || wanted=1
    done
    [ "$wanted" = 1 ] || continue
  fi
  name="cms-worker-$shard"
  # The panel cannot resolve host bind paths for recreation. Pin the existing
  # ID and validate fleet ownership before touching any container.
  metadata="$(docker inspect --format '{{.Id}} {{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}}' "$name")" || {
    echo "Worker $shard is absent; deploy it with make worker on the host." >&2
    exit 1
  }
  read -r id project service <<< "$metadata"
  if [[ ! "$id" =~ ^[a-f0-9]{64}$ ]] || [ "$project" != "cw$shard" ] || [ "$service" != worker ]; then
    echo "Refusing $name: expected fleet project cw$shard and service worker." >&2
    exit 1
  fi
  containers+=("$id")
  selected+=("$shard")
done <<< "$fleet"

for target in "$@"; do
  found=0
  for shard in "${selected[@]}"; do
    [ "$target" != "$shard" ] || found=1
  done
  [ "$found" = 1 ] || { echo "Worker $target is not a local fleet entry." >&2; exit 1; }
done
if [ "${#containers[@]}" = 0 ]; then
  echo 'No local fleet workers; nothing changed. Deploy new workers with make worker on the host.'
  exit 0
fi

docker "$action" "${containers[@]}"
echo 'Existing worker containers only; images, environment, resources, and mounts were not recreated. Use make worker on the host to deploy changes.'
