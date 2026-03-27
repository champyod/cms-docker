#!/usr/bin/env bash
set -euo pipefail

PROJECT_PREFIX="${1:-cms-worker-0}"
CONTAINER_NAME="cms-worker-0"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "ERROR: container $CONTAINER_NAME is not running"
  exit 1
fi

echo "[1/6] Container status"
docker ps --filter "name=$CONTAINER_NAME" --format '{{.Names}} {{.Status}}'

echo "[2/6] Isolate version"
docker exec -i "$CONTAINER_NAME" sh -lc 'isolate --version | head -1'

echo "[3/6] Isolate cgroup config"
docker exec -i "$CONTAINER_NAME" sh -lc 'cat /run/isolate/cgroup && test -f /run/isolate/cgroup'

echo "[4/6] isolate --cg init/run/cleanup"
docker exec -i "$CONTAINER_NAME" sh -lc 'isolate --box-id=99 --cg --cleanup >/dev/null 2>&1 || true; isolate --box-id=99 --cg --init >/tmp/iso.init && isolate --box-id=99 --cg --run -- /bin/echo worker-security-ok && isolate --box-id=99 --cg --cleanup >/tmp/iso.clean; echo isolate_cg_ok'

echo "[5/6] Worker connection log check"
docker logs "$CONTAINER_NAME" | tail -120 | grep -E 'Worker [0-9]+ up and running|Established connection' || true

echo "[6/6] Security options and capabilities"
docker inspect "$CONTAINER_NAME" --format 'Privileged={{.HostConfig.Privileged}} SecurityOpt={{.HostConfig.SecurityOpt}} CapAdd={{.HostConfig.CapAdd}} ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} PidsLimit={{.HostConfig.PidsLimit}}'

echo "Validation complete."
