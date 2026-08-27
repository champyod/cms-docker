#!/usr/bin/env bash
# scripts/__domain.sh — Domain & TLS certificate orchestration.
#
# Manages setup, status, renewal, and preflight checks for domain names,
# TLS certificates (Let's Encrypt / provided / self-signed), nginx config
# rendering, and DNS verification.
#
# Usage:
#   __domain.sh setup   [options]   configure domains + TLS + nginx
#   __domain.sh status              show DNS, cert expiry, renewal, connectivity
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
# Defaults
# ---------------------------------------------------------------------------
DOMAIN_NAME="${DOMAIN_NAME:-grader.mwit.ac.th}"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-admin.grader.mwit.ac.th}"
OJ_DOMAIN="${OJ_DOMAIN:-oj.grader.mwit.ac.th}"
RANKING_DOMAIN="${RANKING_DOMAIN:-ranking.grader.mwit.ac.th}"
CERT_TYPE="${CERT_TYPE:-letsencrypt}"
CERT_PATH=""
KEY_PATH=""
CERT_EMAIL="${CERT_EMAIL:-admin@mwit.ac.th}"
HSTS_MAX_AGE="${HSTS_MAX_AGE:-31536000}"
REDIS_RATE_LIMIT="${REDIS_RATE_LIMIT:-0}"
PER_USER_LIMIT="${PER_USER_LIMIT:-1}"
REDIS_HOST="${REDIS_HOST:-redis-rate-limit}"
REDIS_PORT="${REDIS_PORT:-6379}"
MONITORING_ENABLED="${MONITORING_ENABLED:-0}"
TAILSCALE_IP="${TAILSCALE_IP:-127.0.0.1}"
CONTEST_LISTEN_PORT="${CONTEST_LISTEN_PORT:-8888}"
ADMIN_LISTEN_PORT="${ADMIN_LISTEN_PORT:-8889}"
RANKING_LISTEN_PORT="${RANKING_LISTEN_PORT:-8890}"
OJ_BACKEND_PORT="${OJ_BACKEND_PORT:-9000}"
DRY_RUN=1

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
  --domain <domain>           Primary domain (default: grader.mwit.ac.th)
  --admin-domain <domain>     Admin subdomain (default: admin.grader.mwit.ac.th)
  --oj-domain <domain>        OJ subdomain (default: oj.grader.mwit.ac.th)
  --ranking-domain <domain>   Ranking subdomain (default: ranking.grader.mwit.ac.th)
  --cert-path <path>          Path to fullchain.pem (required for --cert provided)
  --key-path <path>           Path to privkey.pem (required for --cert provided)
  --email <email>             Email for Let's Encrypt registration
  --dry-run                   Print actions without executing (default)
  --apply                     Actually execute changes

All commands default to dry-run. Use --apply to enforce.
EOF
}

# ---------------------------------------------------------------------------
# Setup subcommand
# ---------------------------------------------------------------------------
cmd_setup() {
  log_info "Domain setup — mode: $([ "$DRY_RUN" -eq 1 ] && echo 'DRY-RUN' || echo 'APPLY')"
  log_info "Primary: $DOMAIN_NAME  Admin: $ADMIN_DOMAIN  OJ: $OJ_DOMAIN  Ranking: $RANKING_DOMAIN"
  log_info "Certificate type: $CERT_TYPE"

  # Validate port 80 reachability for Let's Encrypt
  if [[ "$CERT_TYPE" == "letsencrypt" ]]; then
    _preflight_port80
  fi

  # Create cert directories
  local cert_dir="${REPO_ROOT}/config/letsencrypt"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would create directory: $cert_dir"
  else
    mkdir -p "$cert_dir"
    log_info "created $cert_dir"
  fi

  # Render nginx config from template
  _render_nginx_config

  # Handle certificate type
  case "$CERT_TYPE" in
    letsencrypt)
      _setup_letsencrypt
      ;;
    provided)
      _setup_provided_cert
      ;;
    selfsigned)
      _setup_selfsigned
      ;;
    *)
      log_die "unknown cert type: $CERT_TYPE — use letsencrypt, provided, or selfsigned" 1
      ;;
  esac

  # Validate nginx config
  _validate_nginx_config

  discord_alert "Domain setup completed for ${DOMAIN_NAME} (cert: ${CERT_TYPE})" 65280
  log_info "Domain setup complete"
}

# ---------------------------------------------------------------------------
# Let's Encrypt setup
# ---------------------------------------------------------------------------
_setup_letsencrypt() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would run certbot certonly for $DOMAIN_NAME, $ADMIN_DOMAIN, $OJ_DOMAIN, $RANKING_DOMAIN"
    return 0
  fi

  if ! command -v certbot >/dev/null 2>&1; then
    log_warn "certbot not found on host — attempting via docker"
    _run_certbot_docker
    return
  fi

  local cert_dir="${REPO_ROOT}/config/letsencrypt"
  certbot certonly --webroot -w "${cert_dir}/www" \
    -d "$DOMAIN_NAME" -d "$ADMIN_DOMAIN" -d "$OJ_DOMAIN" -d "$RANKING_DOMAIN" \
    --email "$CERT_EMAIL" --agree-tos --non-interactive \
    --cert-path "${cert_dir}/live" --key-path "${cert_dir}/live" \
    || log_die "certbot certonly failed" 1
  log_info "Let's Encrypt certificates obtained"
}

_run_certbot_docker() {
  local cert_dir="${REPO_ROOT}/config/letsencrypt"
  mkdir -p "${cert_dir}/www" "${cert_dir}/live"
  docker run --rm \
    -v "${cert_dir}/live:/etc/letsencrypt" \
    -v "${cert_dir}/www:/var/www/certbot" \
    certbot/certbot certonly --webroot -w /var/www/certbot \
    -d "$DOMAIN_NAME" -d "$ADMIN_DOMAIN" -d "$OJ_DOMAIN" -d "$RANKING_DOMAIN" \
    --email "$CERT_EMAIL" --agree-tos --non-interactive \
    || log_die "certbot docker run failed" 1
  log_info "Let's Encrypt certificates obtained via docker"
}

# ---------------------------------------------------------------------------
# Provided certificate setup
# ---------------------------------------------------------------------------
_setup_provided_cert() {
  if [[ -z "$CERT_PATH" || -z "$KEY_PATH" ]]; then
    log_die "--cert-path and --key-path are required for --cert provided" 1
  fi

  if [[ ! -f "$CERT_PATH" ]]; then
    log_die "certificate file not found: $CERT_PATH" 1
  fi
  if [[ ! -f "$KEY_PATH" ]]; then
    log_die "private key file not found: $KEY_PATH" 1
  fi

  # Public trust check
  if ! openssl verify -untrusted "$CERT_PATH" "$CERT_PATH" >/dev/null 2>&1; then
    log_warn "certificate failed openssl verify — may not be trusted by clients"
  else
    log_info "certificate passed openssl verify"
  fi

  local dest_dir="${REPO_ROOT}/config/letsencrypt/live"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would copy $CERT_PATH -> ${dest_dir}/fullchain.pem"
    log_info "[dry-run] would copy $KEY_PATH -> ${dest_dir}/privkey.pem"
  else
    mkdir -p "$dest_dir"
    cp -f "$CERT_PATH" "${dest_dir}/fullchain.pem"
    cp -f "$KEY_PATH" "${dest_dir}/privkey.pem"
    chmod 600 "${dest_dir}/privkey.pem"
    log_info "provided certificates installed to $dest_dir"
  fi
}

# ---------------------------------------------------------------------------
# Self-signed certificate setup
# ---------------------------------------------------------------------------
_setup_selfsigned() {
  local dest_dir="${REPO_ROOT}/config/letsencrypt/live"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would generate self-signed cert for $DOMAIN_NAME"
    return 0
  fi

  mkdir -p "$dest_dir"
  openssl req -x509 -nodes -days 365 \
    -newkey rsa:2048 \
    -keyout "${dest_dir}/privkey.pem" \
    -out "${dest_dir}/fullchain.pem" \
    -subj "/CN=${DOMAIN_NAME}/O=CMS/C=TH" \
    2>/dev/null
  chmod 600 "${dest_dir}/privkey.pem"
  log_info "self-signed certificate generated for $DOMAIN_NAME"
}

# ---------------------------------------------------------------------------
# Nginx config rendering
# ---------------------------------------------------------------------------
_render_nginx_config() {
  local template="${REPO_ROOT}/config/grader.nginx.conf.template"
  local output="${REPO_ROOT}/config/grader.nginx.conf"

  if [[ ! -f "$template" ]]; then
    log_warn "nginx template not found: $template — skipping render"
    return 0
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would render $template -> $output"
    log_info "[dry-run] variables: DOMAIN_NAME=$DOMAIN_NAME HSTS_MAX_AGE=$HSTS_MAX_AGE REDIS_RATE_LIMIT=$REDIS_RATE_LIMIT PER_USER_LIMIT=$PER_USER_LIMIT REDIS_HOST=$REDIS_HOST REDIS_PORT=$REDIS_PORT MONITORING_ENABLED=$MONITORING_ENABLED"
    return 0
  fi

  export DOMAIN_NAME ADMIN_DOMAIN OJ_DOMAIN RANKING_DOMAIN HSTS_MAX_AGE
  export CONTEST_LISTEN_PORT ADMIN_LISTEN_PORT RANKING_LISTEN_PORT OJ_BACKEND_PORT
  export RANKING_AUTH_DIRECTIVES="${RANKING_AUTH_DIRECTIVES:-}"

  local redis_upstream_block redis_lua_placeholder per_user_login per_user_ranking

  if [[ "${REDIS_RATE_LIMIT:-0}" == "1" ]]; then
    redis_upstream_block=$(cat <<EOF
# Redis distributed rate limit — enabled (REDIS_RATE_LIMIT=1)
# Docker DNS resolver for future OpenResty lua-resty-redis (request-time resolution; nginx starts even if redis absent)
resolver 127.0.0.11 valid=10s ipv6=off;
resolver_timeout 3s;
# Upstream deferred to lua request-time connect to avoid startup DNS failure when redis absent
# upstream redis_rate_limit_backend { server ${REDIS_HOST}:${REDIS_PORT} max_fails=2 fail_timeout=10s; }
# Local limit_req remains as primary until OpenResty image with resty.redis is deployed
EOF
)
    redis_lua_placeholder=$(cat <<'EOLUA'
# Redis rate limiting active: future OpenResty path would use lua-resty-redis token bucket here
# lua_shared_dict redis_limit 10m;
# access_by_lua_block { local r=require("resty.redis"); local red=r:new(); red:set_timeout(80); local ok=red:connect("redis-rate-limit",6379); if ok then local c=red:incr("rl:"..ngx.var.binary_remote_addr); if c==1 then red:expire("rl:"..ngx.var.binary_remote_addr,1) end; if c and c>5 then ngx.exit(503) end end }
# Local limit_req remains as fallback if Redis is unreachable
EOLUA
)
  else
    redis_upstream_block="# REDIS_RATE_LIMIT=0 — local limit_req only (no Redis upstream)"
    redis_lua_placeholder="# REDIS_RATE_LIMIT=0 — Redis disabled, using local limit_req (5r/s admin_login, 10r/s ranking_auth)"
  fi

  if [[ "${PER_USER_LIMIT:-1}" == "1" ]]; then
    per_user_login="limit_req zone=per_user burst=20 nodelay;"
    per_user_ranking="limit_req zone=per_user burst=20 nodelay;"
  else
    per_user_login="# PER_USER_LIMIT=0 — per-user bucket disabled"
    per_user_ranking="# PER_USER_LIMIT=0 — per-user bucket disabled"
  fi

  export REDIS_UPSTREAM_BLOCK="$redis_upstream_block"
  export REDIS_LUA_PLACEHOLDER="$redis_lua_placeholder"
  export PER_USER_LOGIN_DIRECTIVES="$per_user_login"
  export PER_USER_RANKING_DIRECTIVES="$per_user_ranking"

  local nginx_metrics_location
  if [[ "${MONITORING_ENABLED:-0}" == "1" ]]; then
    nginx_metrics_location=$(cat <<EOF
# Monitoring enabled (MONITORING_ENABLED=1) — stub_status for Prometheus
# Scraped as nginx:80/metrics from prometheus job "nginx" (cms-network internal)
# Restricted to loopback + Tailscale IP
location /metrics {
    stub_status;
    allow 127.0.0.1;
    allow ${TAILSCALE_IP:-127.0.0.1};
    deny all;
    access_log off;
}
EOF
)
  else
    nginx_metrics_location="# MONITORING_ENABLED=0 — /metrics not exposed (enable with MONITORING_ENABLED=1 and re-run __domain.sh --apply)"
  fi
  export NGINX_METRICS_LOCATION="$nginx_metrics_location"

  envsubst '${DOMAIN_NAME} ${ADMIN_DOMAIN} ${OJ_DOMAIN} ${RANKING_DOMAIN} ${HSTS_MAX_AGE} ${CONTEST_LISTEN_PORT} ${ADMIN_LISTEN_PORT} ${RANKING_LISTEN_PORT} ${OJ_BACKEND_PORT} ${RANKING_AUTH_DIRECTIVES} ${REDIS_UPSTREAM_BLOCK} ${REDIS_LUA_PLACEHOLDER} ${PER_USER_LOGIN_DIRECTIVES} ${PER_USER_RANKING_DIRECTIVES} ${NGINX_METRICS_LOCATION}' < "$template" > "$output"
  log_info "nginx config rendered: $output (REDIS_RATE_LIMIT=${REDIS_RATE_LIMIT} PER_USER_LIMIT=${PER_USER_LIMIT} MONITORING_ENABLED=${MONITORING_ENABLED})"
}

# ---------------------------------------------------------------------------
# Nginx config validation
# ---------------------------------------------------------------------------
_validate_nginx_config() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would run nginx -t inside docker"
    return 0
  fi

  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'nginx'; then
    local container
    container="$(docker ps --format '{{.Names}}' | grep 'nginx' | head -1)"
    if docker exec "$container" nginx -t 2>&1; then
      log_info "nginx config test passed in $container"
    else
      log_warn "nginx config test failed in $container"
    fi
  else
    log_warn "no nginx container running — skipping nginx -t"
  fi
}

# ---------------------------------------------------------------------------
# Port 80 preflight (for Let's Encrypt HTTP-01 challenge)
# ---------------------------------------------------------------------------
_preflight_port80() {
  log_info "checking port 80 reachability for Let's Encrypt HTTP-01 challenge"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would check port 80 reachability"
    return 0
  fi

  if ! curl -sf -o /dev/null --max-time 5 "http://${DOMAIN_NAME}/" 2>/dev/null; then
    log_warn "port 80 may not be reachable at $DOMAIN_NAME — LE challenge could fail"
  else
    log_info "port 80 reachable at $DOMAIN_NAME"
  fi
}

# ---------------------------------------------------------------------------
# Status subcommand
# ---------------------------------------------------------------------------
cmd_status() {
  log_info "Domain status for $DOMAIN_NAME"
  echo ""

  # DNS resolution
  _status_dns "$DOMAIN_NAME" "primary"
  _status_dns "$ADMIN_DOMAIN" "admin"
  _status_dns "$OJ_DOMAIN" "oj"
  _status_dns "$RANKING_DOMAIN" "ranking"
  echo ""

  # Cert expiry
  _status_cert_expiry
  echo ""

  # Renewal timer
  _status_renewal_timer
  echo ""

  # HTTPS connectivity
  _status_connectivity "$DOMAIN_NAME" "primary"
  _status_connectivity "$ADMIN_DOMAIN" "admin"
  _status_connectivity "$OJ_DOMAIN" "oj"
  _status_connectivity "$RANKING_DOMAIN" "ranking"
}

_status_dns() {
  local domain="$1" label="$2"
  local hosts
  if hosts="$(getent hosts "$domain" 2>/dev/null)"; then
    log_info "DNS [$label] $domain -> $(echo "$hosts" | head -1 | awk '{print $1}')"
  elif command -v dig >/dev/null 2>&1; then
    local ip
    ip="$(dig +short "$domain" 2>/dev/null | head -1)"
    if [[ -n "$ip" ]]; then
      log_info "DNS [$label] $domain -> $ip"
    else
      log_warn "DNS [$label] $domain — NOT RESOLVED"
    fi
  else
    log_warn "DNS [$label] $domain — cannot resolve (no getent, no dig)"
  fi
}

_status_cert_expiry() {
  local cert_dir="${REPO_ROOT}/config/letsencrypt/live"
  local cert_file="${cert_dir}/fullchain.pem"
  if [[ ! -f "$cert_file" ]]; then
    log_warn "no certificate found at $cert_file"
    return 0
  fi

  local expiry
  expiry="$(openssl x509 -enddate -noout -in "$cert_file" 2>/dev/null | sed 's/notAfter=//')"
  if [[ -n "$expiry" ]]; then
    log_info "Certificate expiry: $expiry"
    # Calculate days remaining
    local expiry_epoch now_epoch days_left
    expiry_epoch="$(date -d "$expiry" +%s 2>/dev/null || date -j -f "%b %d %H:%M:%S %Y %Z" "$expiry" +%s 2>/dev/null || echo 0)"
    now_epoch="$(date +%s)"
    if [[ "$expiry_epoch" -gt 0 ]]; then
      days_left=$(( (expiry_epoch - now_epoch) / 86400 ))
      if (( days_left < 7 )); then
        log_warn "Certificate expires in $days_left days — renew immediately!"
      elif (( days_left < 30 )); then
        log_warn "Certificate expires in $days_left days"
      else
        log_info "Certificate valid for $days_left more days"
      fi
    fi
  fi
}

_status_renewal_timer() {
  if systemctl is-enabled certbot.timer 2>/dev/null | grep -q enabled; then
    log_info "Renewal timer: certbot.timer is enabled"
  elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q certbot; then
    log_info "Renewal timer: certbot container is running"
  else
    log_warn "No renewal mechanism detected (certbot.timer or certbot container)"
  fi
}

_status_connectivity() {
  local domain="$1" label="$2"
  if curl -Ikso /dev/null --max-time 5 "https://${domain}/" 2>/dev/null; then
    log_info "HTTPS [$label] $domain — reachable"
  else
    log_warn "HTTPS [$label] $domain — unreachable"
  fi
}

# ---------------------------------------------------------------------------
# Renew subcommand
# ---------------------------------------------------------------------------
cmd_renew() {
  log_info "Certificate renewal — mode: $([ "$DRY_RUN" -eq 1 ] && echo 'DRY-RUN' || echo 'APPLY')"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would force-renew certificates for $DOMAIN_NAME"
    return 0
  fi

  if command -v certbot >/dev/null 2>&1; then
    certbot renew --force-renewal --cert-name "$DOMAIN_NAME" || log_die "certbot renew failed" 1
    log_info "certificates renewed via certbot"
  elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q certbot; then
    local container
    container="$(docker ps --format '{{.Names}}' | grep certbot | head -1)"
    docker exec "$container" certbot renew --force-renewal || log_die "certbot renew failed in container" 1
    log_info "certificates renewed via certbot container ($container)"
  else
    log_die "no certbot found on host or in docker" 1
  fi

  # Reload nginx to pick up new certs
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q nginx; then
    local nginx_container
    nginx_container="$(docker ps --format '{{.Names}}' | grep nginx | head -1)"
    docker exec "$nginx_container" nginx -s reload 2>/dev/null || log_warn "nginx reload failed"
    log_info "nginx reloaded in $nginx_container"
  fi

  discord_alert "Certificates renewed for ${DOMAIN_NAME}" 65280
  log_info "Renewal complete"
}

# ---------------------------------------------------------------------------
# Preflight subcommand — 9-check matrix
# ---------------------------------------------------------------------------
cmd_preflight() {
  log_info "Preflight checks for $DOMAIN_NAME"
  echo ""
  local pass=0 warn=0 fail=0

  # 1. SSH LAN
  _check_ssh && ((pass++)) || ((fail++))

  # 2. Tailscale
  _check_tailscale && ((pass++)) || ((fail++))

  # 3. Remote worker RPC
  _check_worker_rpc && ((pass++)) || ((warn++))

  # 4. Database
  _check_database && ((pass++)) || ((fail++))

  # 5. DNS resolution
  _check_dns && ((pass++)) || ((warn++))

  # 6. HTTP port 80
  _check_http80 && ((pass++)) || ((warn++))

  # 7. HTTPS port 443
  _check_https443 && ((pass++)) || ((warn++))

  # 8. Domain paths
  _check_domain_paths && ((pass++)) || ((warn++))

  # 9. Funnel still works
  _check_funnel && ((pass++)) || ((warn++))

  echo ""
  log_info "Preflight results: PASS=$pass  WARN=$warn  FAIL=$fail"
  if (( fail > 0 )); then
    log_warn "Some checks failed — review above output"
  fi
}

_check_ssh() {
  printf '  %-30s' "SSH LAN:"
  if ss -tlnp 2>/dev/null | grep -q ':22 '; then
    printf 'PASS (port 22 listening)\n'
    return 0
  else
    printf 'FAIL (port 22 not listening)\n'
    return 1
  fi
}

_check_tailscale() {
  printf '  %-30s' "Tailscale:"
  if command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then
    local ts_ip
    ts_ip="$(tailscale ip -4 2>/dev/null || echo 'unknown')"
    printf 'PASS (%s)\n' "$ts_ip"
    return 0
  else
    printf 'FAIL (tailscale not running)\n'
    return 1
  fi
}

_check_worker_rpc() {
  printf '  %-30s' "Remote worker RPC:"
  local worker_host="${WORKER_HOST:-100.75.203.112}"
  local worker_port="${WORKER_RPC_PORT:-26000}"
  if nc -zw3 "$worker_host" "$worker_port" 2>/dev/null; then
    printf 'PASS (%s:%s)\n' "$worker_host" "$worker_port"
    return 0
  else
    printf 'WARN (%s:%s unreachable)\n' "$worker_host" "$worker_port"
    return 1
  fi
}

_check_database() {
  printf '  %-30s' "Database:"
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'cms-database'; then
    local health
    health="$(docker inspect -f '{{.State.Health.Status}}' cms-database 2>/dev/null || echo 'unknown')"
    printf 'PASS (%s)\n' "$health"
    return 0
  else
    printf 'FAIL (cms-database not running)\n'
    return 1
  fi
}

_check_dns() {
  printf '  %-30s' "DNS ($DOMAIN_NAME):"
  if getent hosts "$DOMAIN_NAME" >/dev/null 2>&1; then
    printf 'PASS\n'
    return 0
  else
    printf 'WARN (not resolved)\n'
    return 1
  fi
}

_check_http80() {
  printf '  %-30s' "HTTP :80 ($DOMAIN_NAME):"
  if curl -sf -o /dev/null --max-time 5 "http://${DOMAIN_NAME}/" 2>/dev/null; then
    printf 'PASS\n'
    return 0
  else
    printf 'WARN (unreachable)\n'
    return 1
  fi
}

_check_https443() {
  printf '  %-30s' "HTTPS :443 ($DOMAIN_NAME):"
  if curl -Ikso /dev/null --max-time 5 "https://${DOMAIN_NAME}/" 2>/dev/null; then
    printf 'PASS\n'
    return 0
  else
    printf 'WARN (unreachable)\n'
    return 1
  fi
}

_check_domain_paths() {
  printf '  %-30s' "Domain paths:"
  local ok=1
  for d in "$DOMAIN_NAME" "$ADMIN_DOMAIN" "$OJ_DOMAIN" "$RANKING_DOMAIN"; do
    if ! curl -Ikso /dev/null --max-time 5 "https://${d}/" 2>/dev/null; then
      ok=0
      break
    fi
  done
  if [[ "$ok" -eq 1 ]]; then
    printf 'PASS (all domains reachable)\n'
    return 0
  else
    printf 'WARN (some domains unreachable)\n'
    return 1
  fi
}

_check_funnel() {
  printf '  %-30s' "Funnel:"
  if command -v tailscale >/dev/null 2>&1 && tailscale serve status 2>/dev/null | grep -q 'https'; then
    printf 'PASS\n'
    return 0
  else
    printf 'WARN (not configured or not running)\n'
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
cmd="${1:-}"
shift || true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cert)       CERT_TYPE="$2"; shift 2 ;;
    --domain)     DOMAIN_NAME="$2"; shift 2 ;;
    --admin-domain) ADMIN_DOMAIN="$2"; shift 2 ;;
    --oj-domain)  OJ_DOMAIN="$2"; shift 2 ;;
    --ranking-domain) RANKING_DOMAIN="$2"; shift 2 ;;
    --cert-path)  CERT_PATH="$2"; shift 2 ;;
    --key-path)   KEY_PATH="$2"; shift 2 ;;
    --email)      CERT_EMAIL="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --apply)      DRY_RUN=0; shift ;;
    --help|-h)    usage; exit 0 ;;
    *)            log_die "unknown option: $1 — see --help" 1 ;;
  esac
done

case "$cmd" in
  setup)    cmd_setup ;;
  status)   cmd_status ;;
  renew)    cmd_renew ;;
  preflight) cmd_preflight ;;
  --help|-h|help) usage; exit 0 ;;
  "")       usage; exit 1 ;;
  *)        log_die "unknown command: $cmd — see --help" 1 ;;
esac
