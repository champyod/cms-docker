#!/usr/bin/env bash
set -eu
# pipefail only if available
if (set -o pipefail 2>/dev/null); then
    set -o pipefail
fi

CGROUP_PATH="${1:-/sys/fs/cgroup/cms-isolate}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0 [cgroup-path]"
  exit 1
fi

if ! mount | grep -q "type cgroup2"; then
  echo "ERROR: cgroup v2 is not mounted. isolate --cg requires cgroup v2."
  exit 1
fi

ROOT_CONTROL_FILE="/sys/fs/cgroup/cgroup.subtree_control"
if [ ! -f "$ROOT_CONTROL_FILE" ]; then
  echo "ERROR: Missing $ROOT_CONTROL_FILE"
  exit 1
fi

if [ ! -f /etc/systemd/system/docker.service.d/10-delegate.conf ]; then
  mkdir -p /etc/systemd/system/docker.service.d
  cat > /etc/systemd/system/docker.service.d/10-delegate.conf <<'EOF'
[Service]
Delegate=yes
TasksMax=infinity
EOF
  systemctl daemon-reload
  systemctl restart docker
fi

echo "+cpu +memory +pids" > "$ROOT_CONTROL_FILE" 2>/dev/null || true

mkdir -p "$CGROUP_PATH"
chmod 755 "$CGROUP_PATH"

echo "+cpu +memory +pids" > "$CGROUP_PATH/cgroup.subtree_control" 2>/dev/null || true

echo "Worker cgroup delegation prepared: $CGROUP_PATH"
echo "Use this in worker env: ISOLATE_CGROUP_PATH=$CGROUP_PATH"
