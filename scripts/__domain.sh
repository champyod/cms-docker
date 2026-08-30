#!/usr/bin/env bash
# scripts/__domain.sh — Domain & TLS certificate orchestration.
#
# Manages setup, status, renewal, and preflight checks for domain names,
# TLS certificates (Let's Encrypt / provided / self-signed), nginx config
# rendering, and DNS verification.
#
# Usage:
#   __domain.sh setup   [options]   configure domains + TLS + nginx
#   __domain.sh status              show DNS resolution, cert expiry, renewal timer, connectivity
#   __domain.sh renew               force-renew LE certs or swap provided certs
#   __domain.sh preflight           9-check connectivity matrix
#
# All commands default to dry-run (print only). Pass --apply to enforce.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# lib/common.sh — source if present, else provide fallbacks.
# ---------------------------------------------------------------------------
if [[ -f "${SCRIPT_DIR}/__lib/common.sh" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/__lib/common.sh"
else
  log_info()  { printf '[INFO] %s\n' "$*"; }
  log_warn()  { printf '[WARN] %s\n' "$*" >&2; }
  log_die()   { printf '[FAIL] %s\n' "${1:-fatal error}" >&2; exit "${2:-1}"; }
  require_disk_free_gb() { :; }
fi

env_val() {
  awk -F= -v k="$2" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$1" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Load environment files (no override of already-exported vars)
# ---------------------------------------------------------------------------
for env_file in "${REPO_ROOT}/.env.core" "${REPO_ROOT}/.env.admin" "${REPO_ROOT}/.env.infra" "${REPO_ROOT}/.env"; do
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$env_file" 2>/dev/null || true
    set +a
  fi
done

# ---------------------------------------------------------------------------
# Discord alert stub
# ---------------------------------------------------------------------------
discord_alert() {
  local message="${1:-}"
  local color="${2:-3447003}"
  local webhook="${DISCORD_WEBHOOK_URL:-}"
  [[ -z "$webhook" ]] && { log_info "discord_alert: no DISCORD_WEBHOOK_URL set — skipping"; return 0; }
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c '
import json,sys
msg,clr,ts=sys.argv[1],int(sys.argv[2]),sys.argv[3]
body={"embeds":[{"title":"CMS Domain System","description":msg,"color":clr,"timestamp":ts}]}
print(json.dumps(body))
' "$message" "$color" "$ts" | curl -s -H "Content-Type: application/json" -X POST -d @- "$webhook" >/dev/null 2>&1 \
      || log_warn "Discord webhook POST failed"
  else
    log_warn "python3 not found — cannot send Discord alert"
  fi
}

# ---------------------------------------------------------------------------
# Defaults - NO HARDCODED DEFAULTS, all from env with empty fallbacks
# ---------------------------------------------------------------------------
DOMAIN_NAME="${DOMAIN_NAME:-}"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-}"
OJ_DOMAIN="${OJ_DOMAIN:-}"
RANKING_DOMAIN="${RANKING_DOMAIN:-}"
CERT_TYPE="${CERT_TYPE:-letsencrypt}"
CERT_PATH=""
KEY_PATH=""
CERT_EMAIL="${CERT_EMAIL:-}"
HSTS_MAX_AGE="${HSTS_MAX_AGE:-300}"
REDIS_RATE_LIMIT="${REDIS_RATE_LIMIT:-0}"
PER_USER_LIMIT="${PER_USER_LIMIT:-1}"
REDIS_HOST="${REDIS_HOST:-redis-rate-limit}"
REDIS_PORT="${REDIS_PORT:-6379}"
MONITORING_ENABLED="${MONITORING_ENABLED:-0}"
TAILSCALE_IP="${TAILSCALE_IP:-}"
WAF_ENABLED="${WAF_ENABLED:-0}"
WAF_PORT="${WAF_PORT:-8080}"
WAF_BIND_IP="${WAF_BIND_IP:-127.0.0.1}"
WAF_PARANOIA="${WAF_PARANOIA:-1}"
WAF_ANOMALY_INBOUND="${WAF_ANOMALY_INBOUND:-5}"
WAF_ANOMALY_OUTBOUND="${WAF_ANOMALY_OUTBOUND:-4}"
WAF_RULE_ENGINE="${WAF_RULE_ENGINE:-DetectionOnly}"
CONTEST_LISTEN_PORT="${CONTEST_LISTEN_PORT:-8888}"
ADMIN_LISTEN_PORT="${ADMIN_LISTEN_PORT:-8889}"
RANKING_LISTEN_PORT="${RANKING_LISTEN_PORT:-8890}"

RANKING_LISTEN_PORT="${RANKING_LISTEN_PORT:-8890}"
OJ_BACKEND_PORT="${OJ_BACKEND_PORT:-9000}"
# Optional features — disabled by default (0), prod stays off unless explicitly enabled
HSM_ENABLED="${HSM_ENABLED:-0}"
HSM_MODULE="${HSM_MODULE:-softhsm}"
HSM_PIN="${HSM_PIN:-}"
HSM_KEY_LABEL="${HSM_KEY_LABEL:-grader-privkey}"
VAULT_ENABLED="${VAULT_ENABLED:-0}"
VAULT_ADDR="${VAULT_ADDR:-}"
VAULT_TOKEN="${VAULT_TOKEN:-}"
VAULT_PATH="${VAULT_PATH:-secret/cms}"
DNSSEC_ENABLED="${DNSSEC_ENABLED:-0}"
CAA_ENABLED="${CAA_ENABLED:-0}"
CAA_ISSUER="${CAA_ISSUER:-letsencrypt.org}"
MTLS_WORKERS_ENABLED="${MTLS_WORKERS_ENABLED:-0}"
MTLS_CA_CERT="${MTLS_CA_CERT:-config/mtls/ca.pem}"
MTLS_WORKER_CERT="${MTLS_WORKER_CERT:-config/mtls/worker.pem}"
MTLS_WORKER_KEY="${MTLS_WORKER_KEY:-config/mtls/worker-key.pem}"
DRY_RUN=1
AUTO_YES=0

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
Usage: __domain.sh <command> [options]

Commands:
  setup     Configure domains, TLS certificates, and render nginx config
  status    Show DNS resolution, cert expiry, renewal timer, connectivity
  renew     Force-renew Let's Encrypt certs or swap provided certificates
  preflight 9-check matrix: SSH, Tailscale, RPC, DB, DNS, HTTP, HTTPS, paths, funnel

Options (setup):
  --cert <letsencrypt|provided|selfsigned>  Certificate type (default: letsencrypt)
  --domain <domain>           Primary domain (REQUIRED - no default)
  --admin-domain <domain>     Admin subdomain
  --oj-domain <domain>        OJ subdomain
  --ranking-domain <domain>   Ranking subdomain
  --cert-path <path>          Path to fullchain.pem (required for --cert provided)
  --key-path <path>           Path to privkey.pem (required for --cert provided)
  --email <email>             Email for Let's Encrypt registration
  --dry-run                   Print actions without executing (default)
  --apply                     Actually execute changes
  --yes, -y                   Skip optional prompts (HSM/Vault/DNSSEC/mTLS stay disabled)

Optional features (disabled by default — prod stays off):
  HSM_ENABLED=0  Vault, DNSSEC/CAA, mTLS workers are opt-in via prompts
  HSM: --hsm PKCS#11 via config/hsm/* (SoftHSM dev / YubiHSM ~$800 / CloudHSM ~$30/mo)
  Vault: hashicorp/vault:1.15 via --profile vault (or see scripts/__secrets-rotate.sh)
  DNSSEC/CAA: DNS only — see docs/dnssec-caa-guide.md
  mTLS: TAILSCALE_IP allow ALL when MTLS_WORKERS_ENABLED=0; mTLS only when 1

All commands default to dry-run. Use --apply to enforce.
EOF
}

# ---------------------------------------------------------------------------
# Optional features: prompt + log (never forced, disabled by default)
# ---------------------------------------------------------------------------
_prompt_optional_features() {
  if [[ "$AUTO_YES" -eq 1 ]] || [[ ! -t 0 ]]; then
    return 0
  fi
  local ans
  if [[ "${HSM_ENABLED:-0}" == "0" ]]; then
    printf "Enable HSM (SoftHSM/YubiHSM/CloudHSM) for TLS key on hardware? [y/N] "
    read -r ans || true
    if [[ "$ans" =~ ^[Yy] ]]; then
      HSM_ENABLED=1
      printf "  HSM module (softhsm|yubihsm|cloudhsm) [%s]: " "$HSM_MODULE"
      read -r ans || true
      [[ -n "$ans" ]] && HSM_MODULE="$ans"
      printf "  HSM PIN (will be stored in .env.local — gitignored): "
      read -r -s ans || true; echo ""
      [[ -n "$ans" ]] && HSM_PIN="$ans"
      printf "  HSM key label [%s]: " "$HSM_KEY_LABEL"
      read -r ans || true
      [[ -n "$ans" ]] && HSM_KEY_LABEL="$ans"
    fi
  fi
  if [[ "${VAULT_ENABLED:-0}" == "0" ]]; then
    printf "Enable HashiCorp Vault for secret auto-rotation? [y/N] "
    read -r ans || true
    if [[ "$ans" =~ ^[Yy] ]]; then
      VAULT_ENABLED=1
      printf "  Vault addr [%s]: " "$VAULT_ADDR"
      read -r ans || true
      [[ -n "$ans" ]] && VAULT_ADDR="$ans"
      printf "  Vault token (gitignored via .env.local): "
      read -r -s ans || true; echo ""
      [[ -n "$ans" ]] && VAULT_TOKEN="$ans"
      printf "  Vault path [%s]: " "$VAULT_PATH"
      read -r ans || true
      [[ -n "$ans" ]] && VAULT_PATH="$ans"
    fi
  fi
  if [[ "${DNSSEC_ENABLED:-0}" == "0" ]] && [[ "${CAA_ENABLED:-0}" == "0" ]]; then
    printf "Enable DNSSEC (DNS spoof protection) — needs DNS + computer center? [y/N] "
    read -r ans || true
    if [[ "$ans" =~ ^[Yy] ]]; then
      DNSSEC_ENABLED=1
      CAA_ENABLED=1
      printf "  CAA issuer [%s]: " "$CAA_ISSUER"
      read -r ans || true
      [[ -n "$ans" ]] && CAA_ISSUER="$ans"
    fi
  fi
  if [[ "${MTLS_WORKERS_ENABLED:-0}" == "0" ]]; then
    printf "Enable mTLS for worker RPC (beyond Tailscale IP allowlist)? [y/N] "
    read -r ans || true
    if [[ "$ans" =~ ^[Yy] ]]; then
      MTLS_WORKERS_ENABLED=1
      printf "  mTLS CA cert path [%s]: " "$MTLS_CA_CERT"
      read -r ans || true
      [[ -n "$ans" ]] && MTLS_CA_CERT="$ans"
      printf "  mTLS worker cert [%s]: " "$MTLS_WORKER_CERT"
      read -r ans || true
      [[ -n "$ans" ]] && MTLS_WORKER_CERT="$ans"
      printf "  mTLS worker key [%s]: " "$MTLS_WORKER_KEY"
      read -r ans || true
      [[ -n "$ans" ]] && MTLS_WORKER_KEY="$ans"
    fi
  fi
}

_log_optional_features() {
  if [[ "${HSM_ENABLED:-0}" == "0" ]]; then
    log_info "HSM disabled (set HSM_ENABLED=1 to enable — see .env.infra.example HSM_*)"
  fi
  if [[ "${VAULT_ENABLED:-0}" == "0" ]]; then
    log_info "Vault disabled (set VAULT_ENABLED=1 to enable — see .env.infra.example VAULT_*; alternative: scripts/__secrets-rotate.sh)"
  fi
  if [[ "${DNSSEC_ENABLED:-0}" == "0" ]] && [[ "${CAA_ENABLED:-0}" == "0" ]]; then
    log_info "DNSSEC disabled (set DNSSEC_ENABLED=1 to enable) — CAA disabled (set CAA_ENABLED=1, CAA_ISSUER=letsencrypt.org)"
  fi
  if [[ "${MTLS_WORKERS_ENABLED:-0}" == "0" ]]; then
    log_info "mTLS workers disabled (set MTLS_WORKERS_ENABLED=1 to enable — TAILSCALE_IP allow ALL remains)"
  fi
}

# ... rest of the file remains the same ...