#!/usr/bin/env bash
# scripts/__firewall-setup.sh — iptables/nftables firewall management.
#
# Manages INPUT and DOCKER-USER chain rules for the grader host.
# Default mode is dry-run (print only). --apply enforces rules.
# --revert flushes custom rules added by this script.
#
# Rules:
#   INPUT: allow lo, tailscale0 ALL, tcp 22 from SSH_LAN_CIDR on the main
#          interface, 80, 443, established, drop else on that interface
#   DOCKER-USER: mirrors INPUT rules + jump from FORWARD chain
#
# Usage:
#   __firewall-setup.sh --check     print planned rules (dry-run)
#   __firewall-setup.sh --apply     enforce rules
#   __firewall-setup.sh --revert    flush custom rules

set -eu
# pipefail only if available
if (set -o pipefail 2>/dev/null); then
    set -o pipefail
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
MODE="check"
SSH_IFACE="${SSH_IFACE:-ens160}"
# SSH_LAN_CIDR has no default on purpose: the admin LAN is a property of the
# site, not of this script, and guessing one either cuts SSH off from the real
# operator network or lets an unrelated network in. Unset means the port 22
# allow rule is omitted, and the catch-all DROP below then blocks SSH entirely —
# so --apply refuses instead of enforcing a half rule set, and --revert leaves
# any earlier port 22 rule alone rather than matching it against a blank value.
SSH_LAN_CIDR="${SSH_LAN_CIDR:-}"
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
  SSH_LAN_CIDR    SSH source CIDR. Site-specific and required — there is no
                  default. Set it to the LAN you administer from: --apply
                  refuses without it, --revert then leaves any earlier port 22
                  rule in place.
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
  if [[ -z "$SSH_LAN_CIDR" ]]; then
    printf 'FAIL (SSH_LAN_CIDR unset)\n'; ((fail++))
  elif ip route get "$SSH_LAN_CIDR" >/dev/null 2>&1; then
    printf 'PASS (%s)\n' "$SSH_LAN_CIDR"; ((pass++))
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
  local ssh22_input ssh22_docker
  if [[ -n "$SSH_LAN_CIDR" ]]; then
    ssh22_input="iptables -A INPUT -i $SSH_IFACE -p tcp -m tcp --dport 22 -s $SSH_LAN_CIDR -j ACCEPT"
    ssh22_docker="iptables -A DOCKER-USER -i $SSH_IFACE -p tcp -m tcp --dport 22 -s $SSH_LAN_CIDR -j ACCEPT"
  else
    ssh22_input="# SSH_LAN_CIDR is unset — port 22 is NOT allowed from any source on $SSH_IFACE"
    ssh22_docker="# SSH_LAN_CIDR is unset — port 22 is NOT passed through DOCKER-USER"
  fi

  cat <<RULES
# CMS Firewall Rules — generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Interface: $SSH_IFACE  Tailscale: $TS_IFACE  SSH LAN: ${SSH_LAN_CIDR:-<unset>}

# --- INPUT chain ---

# Allow loopback
iptables -A INPUT -i lo -j ACCEPT

# Allow ALL on Tailscale (worker RPC, inter-node communication)
iptables -A INPUT -i $TS_IFACE -j ACCEPT

# Allow SSH from the operator LAN only
$ssh22_input

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
$ssh22_docker
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

  # Without the CIDR there is no port 22 rule to match, so any rule applied
  # earlier stays in place rather than being deleted by an unrelated value.
  if [[ -z "$SSH_LAN_CIDR" ]]; then
    log_warn "SSH_LAN_CIDR is unset — existing port 22 rules are left untouched"
  fi

  # Remove rules matching our patterns from INPUT
  while iptables -D INPUT -i lo -j ACCEPT 2>/dev/null; do :; done
  while iptables -D INPUT -i "$TS_IFACE" -j ACCEPT 2>/dev/null; do :; done
  if [[ -n "$SSH_LAN_CIDR" ]]; then
    while iptables -D INPUT -i "$SSH_IFACE" -p tcp -m tcp --dport 22 -s "$SSH_LAN_CIDR" -j ACCEPT 2>/dev/null; do :; done
  fi
  while iptables -D INPUT -i "$SSH_IFACE" -p tcp -m tcp --dport 80 -j ACCEPT 2>/dev/null; do :; done
  while iptables -D INPUT -i "$SSH_IFACE" -p tcp -m tcp --dport 443 -j ACCEPT 2>/dev/null; do :; done
  while iptables -D INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null; do :; done
  while iptables -D INPUT -i "$SSH_IFACE" -j DROP 2>/dev/null; do :; done

  # Remove DOCKER-USER rules
  while iptables -D DOCKER-USER -i lo -j ACCEPT 2>/dev/null; do :; done
  while iptables -D DOCKER-USER -i "$TS_IFACE" -j ACCEPT 2>/dev/null; do :; done
  if [[ -n "$SSH_LAN_CIDR" ]]; then
    while iptables -D DOCKER-USER -i "$SSH_IFACE" -p tcp -m tcp --dport 22 -s "$SSH_LAN_CIDR" -j ACCEPT 2>/dev/null; do :; done
  fi
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
    if [[ -z "$SSH_LAN_CIDR" ]]; then
      log_warn "SSH_LAN_CIDR is unset — port 22 would be dropped on ${SSH_IFACE}; set it to plan an SSH allow rule"
    fi
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

    if [[ $EUID -ne 0 ]]; then
      log_die "firewall --apply requires root — run with sudo" 1
    fi

    if [[ -z "$SSH_LAN_CIDR" ]]; then
      log_die "SSH_LAN_CIDR is unset — the rules would drop SSH on ${SSH_IFACE}. Set it to the LAN you administer from and re-run." 1
    fi

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
