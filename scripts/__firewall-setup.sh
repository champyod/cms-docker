#!/usr/bin/env bash
# scripts/__firewall-setup.sh — iptables/nftables firewall management.
#
# Manages INPUT and DOCKER-USER chain rules for the grader host.
# Default mode is dry-run (print only). --apply enforces rules.
# --revert flushes custom rules added by this script.
#
# Rules:
#   INPUT: allow lo, tailscale0 ALL, ens160 22 from 10.40.50.0/24,
#          80, 443, established, drop else on ens160
#   DOCKER-USER: mirrors INPUT rules + jump from FORWARD chain
#
# Usage:
#   __firewall-setup.sh --check     print planned rules (dry-run)
#   __firewall-setup.sh --apply     enforce rules
#   __firewall-setup.sh --revert    flush custom rules

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# lib/common.sh
# ---------------------------------------------------------------------------
if [[ -f "${SCRIPT_DIR}/__lib/common.sh" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/__lib/common.sh"
else
  log_info()  { printf '[INFO] %s\n' "$*"; }
  log_warn()  { printf '[WARN] %s\n' "$*" >&2; }
  log_die()   { printf '[FAIL] %s\n' "${1:-fatal error}" >&2; exit "${2:-1}"; }
fi

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
MODE="check"
SSH_IFACE="${SSH_IFACE:-ens160}"
SSH_LAN_CIDR="${SSH_LAN_CIDR:-10.40.50.0/24}"
TS_IFACE="${TS_IFACE:-tailscale0}"
WEB_PORTS="80 443"
RULES_FILE="/tmp/cms-firewall-rules.sh"

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
Usage: __firewall-setup.sh <mode>

Modes:
  --check    Dry-run: print planned iptables rules without applying
  --apply    Enforce firewall rules (requires root/sudo)
  --revert   Flush custom CMS rules from INPUT and DOCKER-USER chains

Environment:
  SSH_IFACE       Main network interface (default: ens160)
  SSH_LAN_CIDR    SSH source CIDR (default: 10.40.50.0/24)
  TS_IFACE        Tailscale interface (default: tailscale0)

Rules applied:
  INPUT chain:
    - Allow loopback
    - Allow ALL on tailscale0 (worker RPC, inter-node)
    - Allow TCP 22 from SSH_LAN_CIDR on SSH_IFACE
    - Allow TCP 80,443 on SSH_IFACE
    - Allow ESTABLISHED,RELATED
    - Drop all else on SSH_IFACE

  DOCKER-USER chain:
    - Mirrors INPUT rules
    - Jump from FORWARD chain (idempotent)

Bond audit: scans docker ps for 0.0.0.0 binds and flags risky ports.
Preflight: 9-check matrix runs before --apply (fail-safe).
EOF
}

# ---------------------------------------------------------------------------
# Preflight 9-check matrix (fail-safe before apply)
# ---------------------------------------------------------------------------
preflight_checks() {
  local pass=0 warn=0 fail=0

  printf '  %-30s' "1. SSH listening:"
  if ss -tlnp 2>/dev/null | grep -q ':22 '; then
    printf 'PASS\n'; ((pass++))
  else
    printf 'WARN (port 22 not found)\n'; ((warn++))
  fi

  printf '  %-30s' "2. Tailscale active:"
  if command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then
    printf 'PASS\n'; ((pass++))
  else
    printf 'FAIL (tailscale not running)\n'; ((fail++))
  fi

  printf '  %-30s' "3. Tailscale interface:"
  if ip link show "$TS_IFACE" >/dev/null 2>&1; then
    printf 'PASS (%s exists)\n' "$TS_IFACE"; ((pass++))
  else
    printf 'FAIL (%s not found)\n' "$TS_IFACE"; ((fail++))
  fi

  printf '  %-30s' "4. SSH LAN reachable:"
  if ip route get "$SSH_LAN_CIDR" >/dev/null 2>&1; then
    printf 'PASS\n'; ((pass++))
  else
    printf 'WARN (CIDR not directly routable)\n'; ((warn++))
  fi

  printf '  %-30s' "5. Database container:"
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'cms-database'; then
    printf 'PASS\n'; ((pass++))
  else
    printf 'FAIL\n'; ((fail++))
  fi

  printf '  %-30s' "6. HTTP :80 local:"
  if curl -sf -o /dev/null --max-time 3 'http://127.0.0.1/' 2>/dev/null; then
    printf 'PASS\n'; ((pass++))
  else
    printf 'WARN (not reachable locally)\n'; ((warn++))
  fi

  printf '  %-30s' "7. HTTPS :443 local:"
  if curl -Ikso /dev/null --max-time 3 'https://127.0.0.1/' 2>/dev/null; then
    printf 'PASS\n'; ((pass++))
  else
    printf 'WARN (not reachable locally)\n'; ((warn++))
  fi

  printf '  %-30s' "8. iptables available:"
  if command -v iptables >/dev/null 2>&1; then
    printf 'PASS\n'; ((pass++))
  else
    printf 'FAIL (iptables not found)\n'; ((fail++))
  fi

  printf '  %-30s' "9. Docker accessible:"
  if docker info >/dev/null 2>&1; then
    printf 'PASS\n'; ((pass++))
  else
    printf 'FAIL (docker not accessible)\n'; ((fail++))
  fi

  echo ""
  log_info "Preflight: PASS=$pass  WARN=$warn  FAIL=$fail"

  if (( fail > 0 )); then
    log_warn "Some preflight checks failed — proceeding would risk lockout"
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Docker bind audit
# ---------------------------------------------------------------------------
audit_docker_binds() {
  log_info "Docker bind audit — scanning for 0.0.0.0 exposures"
  local risky_ports=("8888:contest" "26000:worker-rpc" "9000:oj-http" "4443:oj-https" "9001:portainer")

  while IFS= read -r line; do
    local name ports
    name="$(echo "$line" | awk -F'|' '{print $1}')"
    ports="$(echo "$line" | awk -F'|' '{print $2}')"
    if echo "$ports" | grep -qE '0\.0\.0\.0:'; then
      log_warn "EXPOSED: $name binds $ports (0.0.0.0 — publicly accessible)"
    fi
  done < <(docker ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null || true)

  # Specifically flag known risky ports
  for entry in "${risky_ports[@]}"; do
    local port="${entry%%:*}"
    local label="${entry#*:}"
    if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
      log_info "PORT CHECK: $port ($label) — listening"
    fi
  done
}

# ---------------------------------------------------------------------------
# Generate iptables rules
# ---------------------------------------------------------------------------
generate_rules() {
  cat <<RULES
# CMS Firewall Rules — generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Interface: $SSH_IFACE  Tailscale: $TS_IFACE  SSH LAN: $SSH_LAN_CIDR

# --- INPUT chain ---

# Allow loopback
iptables -A INPUT -i lo -j ACCEPT

# Allow ALL on Tailscale (worker RPC, inter-node communication)
iptables -A INPUT -i $TS_IFACE -j ACCEPT

# Allow SSH from LAN only
iptables -A INPUT -i $SSH_IFACE -p tcp -m tcp --dport 22 -s $SSH_LAN_CIDR -j ACCEPT

# Allow HTTP and HTTPS
iptables -A INPUT -i $SSH_IFACE -p tcp -m tcp --dport 80 -j ACCEPT
iptables -A INPUT -i $SSH_IFACE -p tcp -m tcp --dport 443 -j ACCEPT

# Allow established/related connections
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# Drop everything else on main interface
iptables -A INPUT -i $SSH_IFACE -j DROP

# --- DOCKER-USER chain ---

# Ensure DOCKER-USER jump from FORWARD (idempotent)
iptables -C FORWARD -j DOCKER-USER 2>/dev/null || iptables -I FORWARD -j DOCKER-USER

# Mirror INPUT rules in DOCKER-USER
iptables -A DOCKER-USER -i lo -j ACCEPT
iptables -A DOCKER-USER -i $TS_IFACE -j ACCEPT
iptables -A DOCKER-USER -i $SSH_IFACE -p tcp -m tcp --dport 22 -s $SSH_LAN_CIDR -j ACCEPT
iptables -A DOCKER-USER -i $SSH_IFACE -p tcp -m tcp --dport 80 -j ACCEPT
iptables -A DOCKER-USER -i $SSH_IFACE -p tcp -m tcp --dport 443 -j ACCEPT
iptables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A DOCKER-USER -i $SSH_IFACE -j DROP

RULES
}

# ---------------------------------------------------------------------------
# Revert: flush custom CMS rules
# ---------------------------------------------------------------------------
flush_custom_rules() {
  log_info "Flushing custom CMS firewall rules"

  # Remove rules matching our patterns from INPUT
  while iptables -D INPUT -i lo -j ACCEPT 2>/dev/null; do :; done
  while iptables -D INPUT -i "$TS_IFACE" -j ACCEPT 2>/dev/null; do :; done
  while iptables -D INPUT -i "$SSH_IFACE" -p tcp -m tcp --dport 22 -s "$SSH_LAN_CIDR" -j ACCEPT 2>/dev/null; do :; done
  while iptables -D INPUT -i "$SSH_IFACE" -p tcp -m tcp --dport 80 -j ACCEPT 2>/dev/null; do :; done
  while iptables -D INPUT -i "$SSH_IFACE" -p tcp -m tcp --dport 443 -j ACCEPT 2>/dev/null; do :; done
  while iptables -D INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null; do :; done
  while iptables -D INPUT -i "$SSH_IFACE" -j DROP 2>/dev/null; do :; done

  # Remove DOCKER-USER rules
  while iptables -D DOCKER-USER -i lo -j ACCEPT 2>/dev/null; do :; done
  while iptables -D DOCKER-USER -i "$TS_IFACE" -j ACCEPT 2>/dev/null; do :; done
  while iptables -D DOCKER-USER -i "$SSH_IFACE" -p tcp -m tcp --dport 22 -s "$SSH_LAN_CIDR" -j ACCEPT 2>/dev/null; do :; done
  while iptables -D DOCKER-USER -i "$SSH_IFACE" -p tcp -m tcp --dport 80 -j ACCEPT 2>/dev/null; do :; done
  while iptables -D DOCKER-USER -i "$SSH_IFACE" -p tcp -m tcp --dport 443 -j ACCEPT 2>/dev/null; do :; done
  while iptables -D DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null; do :; done
  while iptables -D DOCKER-USER -i "$SSH_IFACE" -j DROP 2>/dev/null; do :; done

  log_info "Custom CMS rules flushed"
}

# ---------------------------------------------------------------------------
# Current rules display
# ---------------------------------------------------------------------------
show_current_rules() {
  log_info "Current iptables INPUT chain:"
  iptables -L INPUT -n -v 2>/dev/null || log_warn "cannot read INPUT chain"
  echo ""
  log_info "Current iptables DOCKER-USER chain:"
  iptables -L DOCKER-USER -n -v 2>/dev/null || log_warn "cannot read DOCKER-USER chain"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)  MODE="check"; shift ;;
    --apply)  MODE="apply"; shift ;;
    --revert) MODE="revert"; shift ;;
    --help|-h) usage; exit 0 ;;
    *)        log_die "unknown option: $1 — see --help" 1 ;;
  esac
done

case "$MODE" in
  check)
    log_info "Firewall check mode (dry-run)"
    echo ""
    audit_docker_binds
    echo ""
    log_info "Planned iptables rules:"
    generate_rules
    echo ""
    show_current_rules
    ;;

  apply)
    log_info "Firewall apply mode (enforcing)"
    echo ""

    # Require root
    if [[ $EUID -ne 0 ]]; then
      log_die "firewall --apply requires root — run with sudo" 1
    fi

    # Run preflight checks
    if ! preflight_checks; then
      log_die "preflight checks failed — aborting to prevent lockout" 1
    fi

    audit_docker_binds
    echo ""

    log_info "Applying iptables rules..."
    generate_rules | bash
    log_info "Firewall rules applied"
    show_current_rules
    ;;

  revert)
    log_info "Firewall revert mode"

    if [[ $EUID -ne 0 ]]; then
      log_die "firewall --revert requires root — run with sudo" 1
    fi

    flush_custom_rules
    show_current_rules
    ;;
esac
