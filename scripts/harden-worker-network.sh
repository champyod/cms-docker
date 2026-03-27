#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash scripts/harden-worker-network.sh --core-ip <CORE_IP> [--apply]"
  exit 1
fi

CORE_IP=""
APPLY=0
ALLOWED_PORTS="22000,25000,28000,28500,28600,29000"

while [ $# -gt 0 ]; do
  case "$1" in
    --core-ip)
      CORE_IP="$2"
      shift 2
      ;;
    --ports)
      ALLOWED_PORTS="$2"
      shift 2
      ;;
    --apply)
      APPLY=1
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

if [ -z "$CORE_IP" ]; then
  echo "Missing required --core-ip <CORE_IP>"
  exit 1
fi

echo "Preparing worker network hardening"
echo "Core IP: $CORE_IP"
echo "Allowed ports: $ALLOWED_PORTS"

RULES=$(cat <<EOF
iptables -N CMS_WORKER_EGRESS 2>/dev/null || true
iptables -F CMS_WORKER_EGRESS
iptables -C DOCKER-USER -j CMS_WORKER_EGRESS 2>/dev/null || iptables -I DOCKER-USER 1 -j CMS_WORKER_EGRESS
iptables -A CMS_WORKER_EGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A CMS_WORKER_EGRESS -d $CORE_IP -p tcp -m multiport --dports $ALLOWED_PORTS -j ACCEPT
iptables -A CMS_WORKER_EGRESS -d 127.0.0.0/8 -j ACCEPT
iptables -A CMS_WORKER_EGRESS -j DROP
EOF
)

if [ "$APPLY" -eq 1 ]; then
  echo "$RULES" | while IFS= read -r line; do
    [ -n "$line" ] && sh -c "$line"
  done
  echo "Applied iptables egress restrictions for worker containers."
else
  echo "Dry run only. Use --apply to execute:"
  echo "$RULES"
fi
