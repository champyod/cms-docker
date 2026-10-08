#!/usr/bin/env bash
# scripts/__domain.sh — Domain & TLS certificate orchestration.
#
# Manages setup, status, renewal, and preflight checks for domain names,
# TLS certificates (Let's Encrypt / provided / self-signed), nginx config
# rendering, and DNS verification.
#
# Usage:
#   __domain.sh setup   [options]   configure domains + TLS + nginx
#   __domain.sh cert    [options]   issue the certificate only
#   __domain.sh proxy   [options]   render, validate and reload nginx only
#   __domain.sh status              show DNS, cert expiry, renewal, connectivity
#   __domain.sh renew               force-renew LE certs or swap provided certs
#   __domain.sh preflight           9-check connectivity matrix
#
# All commands default to dry-run (print only). Pass --apply to enforce.

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
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__domain_routes.sh"

env_val() {
  awk -F= -v k="$2" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$1" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Load environment files (no override of already-exported vars)
# ---------------------------------------------------------------------------
# --config is pre-parsed here because an alternate file has to be sourced before
# the defaults below read it; the option loop further down only records it.
CONFIG_FILE="${CONFIG_FILE:-}"
for (( _i = 1; _i <= $#; _i++ )); do
  if [[ "${!_i}" == "--config" ]]; then
    _j=$(( _i + 1 )); CONFIG_FILE="${!_j:-}"
  elif [[ "${!_i}" == --config=* ]]; then
    CONFIG_FILE="${!_i#--config=}"
  fi
done

ENV_FILE="${CONFIG_FILE:-${REPO_ROOT}/.env}"
if [[ -n "$CONFIG_FILE" && ! -f "$CONFIG_FILE" ]]; then
  log_die "config file not found: ${CONFIG_FILE}" 1
fi
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ENV_FILE" 2>/dev/null || true
  set +a
fi

# ---------------------------------------------------------------------------
# Discord alert stub
# ---------------------------------------------------------------------------
# discord_payload_json <color> <ts> — the alert body on stdout, with the message on stdin.
# WHY the message arrives on stdin: it names hosts, domains, ports and certificate paths,
# and a process command line is readable by every account on the box for as long as the
# builder lives — the same exposure the webhook token gets, one process earlier.
discord_payload_json() {
  python3 -c '
import json,sys
msg,clr,ts=sys.stdin.read().rstrip("\n"),int(sys.argv[1]),sys.argv[2]
body={"embeds":[{"title":"CMS Domain System","description":msg,"color":clr,"timestamp":ts}]}
print(json.dumps(body))
' "$1" "$2"
}

# discord_post <payload_file> <conf_file> <url> — deliver a prepared alert.
# WHY the webhook lands in a curl config file instead of on the command line: the token in
# that URL is a credential, and a process command line is readable by every account on the
# box for as long as the request lives. The body is read from disk for the same reason, so
# no part of an alert is ever in argv.
discord_post() {
  local payload_file="$1" conf_file="$2" url="$3"
  cat > "$conf_file" <<EOF
url = "${url}"
EOF
  curl -s -H "Content-Type: application/json" -X POST -d "@${payload_file}" -K "$conf_file" >/dev/null 2>&1
}

discord_alert() {
  local message="${1:-}"
  local color="${2:-3447003}"
  local webhook="${DISCORD_WEBHOOK_URL:-}"
  if [[ -z "$webhook" ]]; then
    log_info "discord_alert: no DISCORD_WEBHOOK_URL set — skipping"
    return 0
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    log_warn "python3 not found — cannot send Discord alert"
    return 0
  fi

  local payload_file conf_file
  payload_file="$(mktemp "${TMPDIR:-/tmp}/cms-domain-payload.XXXXXX")" || {
    log_warn "could not stage the Discord payload"
    return 0
  }
  conf_file="$(mktemp "${TMPDIR:-/tmp}/cms-domain-request.XXXXXX")" || {
    rm -f -- "$payload_file"
    log_warn "could not stage the Discord request"
    return 0
  }
  chmod 600 "$payload_file" "$conf_file" 2>/dev/null || true

  # WHY the removal is one statement at the end and not a RETURN trap: a RETURN trap is not
  # scoped to the function that set it, so it fires at some later function's return, with
  # this one's locals already gone. Each step below is captured into a status rather than
  # returned early, so this is the only exit and the payload is never left behind.
  local build_status=0
  discord_payload_json "$color" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > "$payload_file" <<< "$message" || build_status=$?
  if (( build_status != 0 )); then
    log_warn "Discord payload could not be built"
  else
    discord_post "$payload_file" "$conf_file" "$webhook" || log_warn "Discord webhook POST failed"
  fi
  rm -f -- "$payload_file" "$conf_file"
}

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
# Domains — all optional.
#
# Each is independent: any single one is enough to run the proxy, and a deployment
# that serves only the contest UI leaves admin/oj/ranking empty. They default to
# empty rather than to a .local name, because a leftover default would be handed
# to certbot as a SAN and fail validation — a hard error the operator cannot see
# the cause of. CERT_LINEAGE_DOMAIN is derived from whichever is set, because
# certbot names the certificate lineage after the first -d it was given and every
# vhost has to read the certificate from that exact path.
# ---------------------------------------------------------------------------
DOMAIN_NAME="${DOMAIN_NAME:-}"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-}"
OJ_DOMAIN="${OJ_DOMAIN:-}"
RANKING_DOMAIN="${RANKING_DOMAIN:-}"
CERT_LINEAGE_DOMAIN="${CERT_LINEAGE_DOMAIN:-}"
DOMAIN_CERT_METHOD="${DOMAIN_CERT_METHOD:-letsencrypt}"
CERT_PATH=""
KEY_PATH=""
CERT_EMAIL="${CERT_EMAIL:-}"
HSTS_MAX_AGE="${HSTS_MAX_AGE:-31536000}"
REDIS_RATE_LIMIT="${REDIS_RATE_LIMIT:-0}"
PER_USER_LIMIT="${PER_USER_LIMIT:-1}"
REDIS_HOST="${REDIS_HOST:-redis-rate-limit}"
REDIS_PORT="${REDIS_PORT:-6379}"
MONITORING_ENABLED="${MONITORING_ENABLED:-0}"
INNER_IP="${INNER_IP:-127.0.0.1}"
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
OJ_BACKEND_PORT="${OJ_BACKEND_PORT:-9000}"
# Optional features — disabled by default (0), prod stays off unless explicitly enabled
HSM_ENABLED="${HSM_ENABLED:-0}"
HSM_MODULE="${HSM_MODULE:-softhsm}"
HSM_PIN="${HSM_PIN:-}"
HSM_KEY_LABEL="${HSM_KEY_LABEL:-grader-privkey}"
VAULT_ENABLED="${VAULT_ENABLED:-0}"
VAULT_ADDR="${VAULT_ADDR:-http://vault:8200}"
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

# Certificate-issuance retry behaviour. WHY: issuance runs in the window where the
# DNS record and the inbound :80 forward upstream may still be propagating, so a
# first-attempt failure is expected rather than conclusive. Let's Encrypt permits
# only 5 failed validations per account and hostname per hour, which is why the
# attempt cap stays modest and the delay grows up to CERT_RETRY_BACKOFF_CAP.
readonly CERT_RETRY_ATTEMPTS_DEFAULT=8
readonly CERT_RETRY_INTERVAL_DEFAULT=15
readonly CERT_RETRY_BACKOFF_CAP=120
AUTO_RETRY="${AUTO_RETRY:-0}"
CERT_RETRY_ATTEMPTS="${CERT_RETRY_ATTEMPTS:-$CERT_RETRY_ATTEMPTS_DEFAULT}"
CERT_RETRY_INTERVAL="${CERT_RETRY_INTERVAL:-$CERT_RETRY_INTERVAL_DEFAULT}"
# A truthy value here is equivalent to passing --retry-forever: it enables retry
# and clears the attempt cap, so .env and the TUI form can express "keep trying"
# without a command-line flag.
CERT_RETRY_FOREVER="${CERT_RETRY_FOREVER:-0}"
if [[ "$CERT_RETRY_FOREVER" == "1" ]]; then
  AUTO_RETRY=1
  CERT_RETRY_ATTEMPTS=0
fi

# Extended feature flags — every one defaults off so existing runs are unchanged.
EXTRA_DOMAINS="${EXTRA_DOMAINS:-}"
DEPLOY_HOOK="${DEPLOY_HOOK:-}"
LE_STAGING="${LE_STAGING:-0}"
FORCE_RENEWAL="${FORCE_RENEWAL:-0}"
WAIT_PORT80_TIMEOUT="${WAIT_PORT80_TIMEOUT:-0}"
CHECK_EXPIRY_DAYS="${CHECK_EXPIRY_DAYS:-0}"
CHECK_EXPIRY_DAYS_DEFAULT=30
JSON_OUTPUT="${JSON_OUTPUT:-0}"
BACKUP_CERTS="${BACKUP_CERTS:-0}"
USE_LOCK="${USE_LOCK:-0}"
# Narrows a setup run to one of the two concerns the command list spells out as
# verbs: setup is both halves, cert is issuance only, proxy is render+validate+
# reload only. WHY two independent flags rather than one scope value: every decision
# downstream asks one of the two questions on its own — "issue a certificate?", "write
# nginx config?" — and a single enum would make each of those a two-way comparison
# instead of one test.
SETUP_ISSUE_CERT=1
SETUP_RENDER_PROXY=1
# End a live setup by forcing a renewal, so a config change takes effect on the running
# nginx without a second command. Zero by default: a bare setup must not renew a
# certificate that is still valid.
AUTO_RENEW="${AUTO_RENEW:-0}"
REVOKE_REASON="${REVOKE_REASON:-unspecified}"
# DNS-01 challenge (optional). An empty DNS_PROVIDER keeps the HTTP-01 webroot path
# exactly as before; setting it switches issuance to the provider's DNS plugin,
# which is what a wildcard certificate or a host that cannot answer :80 requires.
DNS_PROVIDER="${DNS_PROVIDER:-}"
DNS_CREDENTIALS_FILE="${DNS_CREDENTIALS_FILE:-}"
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
readonly LE_STAGING_DIRECTORY="https://acme-staging-v02.api.letsencrypt.org/directory"
readonly PORT80_POLL_INTERVAL_S=5
readonly PORT80_PROBE_TIMEOUT_S=5
readonly CERT_DIR_NAME="letsencrypt"
readonly CERT_BACKUP_KEEP=5
readonly DOMAIN_LOCK_FILE=".domain.lock"
readonly DOMAIN_PROXY_CONTAINER="grader-nginx-proxy"

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
Usage: __domain.sh <command> [options]

Commands:
  setup        Configure domains, TLS certificates, and render nginx config
  cert         Issue the certificate only — nginx config is neither rendered nor reloaded
  proxy        Render, validate and reload nginx only — the certificate store is untouched
  status       Show DNS resolution, cert expiry, renewal timer, connectivity
  renew        Force-renew Let's Encrypt certs or swap provided certificates
  preflight    9-check matrix: SSH, Tailscale, RPC, DB, DNS, HTTP, HTTPS, paths, funnel
  check-expiry Exit non-zero when the cert is missing or expires within --days
  revoke       Revoke the current certificate

  `cert` and `proxy` are the two halves of `setup` run separately, so a host that has to
  answer a challenge or publish a config can do so one step at a time. `setup` remains
  the full sequence, unchanged.

Options (setup, cert, proxy):
  --cert <letsencrypt|provided|selfsigned>  Certificate type (default: letsencrypt)
  --domain <domain>           Contest/primary host; optional
  --admin-domain <domain>     Admin panel host; optional
  --oj-domain <domain>        External OJ host; optional
  --ranking-domain <domain>   Ranking host; optional

  Every domain is optional and independent — at least one is required, and the rest
  are simply left unset. An unset domain gets no server block, no DNS name and no
  SAN on the certificate. Unset by default: a leftover default name would be handed
  to certbot as a SAN and fail validation.
  --cert-path <path>          Path to fullchain.pem (required for --cert provided)
  --key-path <path>           Path to privkey.pem (required for --cert provided)
  --email <email>             Email for Let's Encrypt registration
  --dry-run                   Print actions without executing (default)
  --apply                     Actually execute changes
  --auto-renew                End a live run by forcing a renewal, so the running nginx
                              picks the new certificate up without a second command
  --yes, -y                   Skip optional prompts (HSM/Vault/DNSSEC/mTLS stay disabled)

Retry options (setup, renew):
  --auto-retry                Retry certificate issuance with backoff until it
                              succeeds or --retry-attempts is reached
  --retry-attempts <n>        Maximum issuance attempts with --auto-retry (default: 8)
  --retry-interval <seconds>  First retry delay; doubles up to 120s (default: 15)
  --retry-forever             Retry with no attempt limit (implies --auto-retry)

Extended options:
  --extra-domains "<names>"   Extra SANs, space-separated, added to the certificate
  --deploy-hook <command>     Run <command> after a successful issue or renewal
  --staging                   Use the Let's Encrypt staging CA (untrusted certs)
  --force                     Re-issue even when the current certificate is valid
  --wait-port80 <seconds>     Wait for HTTP :80 to answer before issuing
  --backup-certs              Snapshot the certificate store before changes
  --lock                      Serialise runs with flock
  --json                      Emit `status` as JSON
  --days <n>                  Expiry threshold for check-expiry (default: 30)
  --reason <reason>           Revocation reason for revoke (default: unspecified)
  --dns <provider>            Use a DNS-01 challenge (e.g. cloudflare) instead of
                              HTTP-01 webroot; needed for wildcards or when :80 cannot
                              be reached from Let's Encrypt
  --dns-credentials <file>    Plugin credentials ini; defaults to a file generated
                              from CLOUDFLARE_API_TOKEN for the cloudflare provider
  --config <file>             Use an alternate env file instead of ./.env

Optional features (disabled by default — prod stays off):
  HSM_ENABLED=0  Vault, DNSSEC/CAA, mTLS workers are opt-in via prompts
  HSM: --hsm PKCS#11 via config/hsm/* (SoftHSM dev / YubiHSM ~$800 / CloudHSM ~$30/mo)
  Vault: hashicorp/vault:1.15 via --profile vault (or see scripts/__secrets-rotate.sh)
  DNSSEC/CAA: DNS only — see docs/dnssec-caa-guide.md
  mTLS: INNER_IP allow ALL when MTLS_WORKERS_ENABLED=0; mTLS only when 1

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
    [[ "$ans" =~ ^[Yy] ]] && DNSSEC_ENABLED=1
    printf "Enable CAA (restrict CA to %s)? [y/N] " "$CAA_ISSUER"
    read -r ans || true
    if [[ "$ans" =~ ^[Yy] ]]; then
      CAA_ENABLED=1
      printf "  CAA issuer [%s]: " "$CAA_ISSUER"
      read -r ans || true
      [[ -n "$ans" ]] && CAA_ISSUER="$ans"
    fi
  fi
  if [[ "${MTLS_WORKERS_ENABLED:-0}" == "0" ]]; then
    printf "Enable mTLS for worker RPC (self-CA, beyond tailnet)? [y/N] "
    read -r ans || true
    if [[ "$ans" =~ ^[Yy] ]]; then
      MTLS_WORKERS_ENABLED=1
      printf "  mTLS CA cert [%s]: " "$MTLS_CA_CERT"
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
  if [[ "${HSM_ENABLED:-0}" == "1" ]]; then
    log_info "HSM enabled (module=$HSM_MODULE label=$HSM_KEY_LABEL) — certbot will use --hsm with PKCS#11"
  else
    log_info "HSM disabled (set HSM_ENABLED=1 in config.toml [infra] to enable)"
  fi
  if [[ "${VAULT_ENABLED:-0}" == "1" ]]; then
    log_info "Vault enabled (addr=$VAULT_ADDR path=$VAULT_PATH) — secrets via Vault"
  else
    log_info "Vault disabled (set VAULT_ENABLED=1 in config.toml [infra] to enable; alternative: scripts/__secrets-rotate.sh)"
  fi
  if [[ "${DNSSEC_ENABLED:-0}" == "1" ]] || [[ "${CAA_ENABLED:-0}" == "1" ]]; then
    log_info "DNSSEC=${DNSSEC_ENABLED} CAA=${CAA_ENABLED} (issuer=$CAA_ISSUER) — see docs/dnssec-caa-guide.md"
  else
    log_info "DNSSEC disabled (set DNSSEC_ENABLED=1 to enable) — CAA disabled (set CAA_ENABLED=1, CAA_ISSUER=letsencrypt.org)"
  fi
  if [[ "${MTLS_WORKERS_ENABLED:-0}" == "1" ]]; then
    log_info "mTLS workers enabled (CA=$MTLS_CA_CERT) — firewall should restrict RPC to mTLS only"
  else
    log_info "mTLS workers disabled (set MTLS_WORKERS_ENABLED=1 to enable — INNER_IP allow ALL remains)"
  fi
}

# ---------------------------------------------------------------------------
# Domain helpers
# ---------------------------------------------------------------------------

# Prints every configured domain, one per line, in render order.
# WHY this rather than four separate tests at each call site: certbot's SAN list,
# the ACME vhost, status, preflight and the template filter all need the same set,
# and the moment they are enumerated separately they drift — an omitted domain
# shows up as an ACME failure against a name nobody asked for.
_configured_domains() {
  local domain
  for domain in "$DOMAIN_NAME" "$ADMIN_DOMAIN" "$OJ_DOMAIN" "$RANKING_DOMAIN"; do
    if [[ -n "$domain" ]]; then
      printf '%s\n' "$domain"
    fi
  done
  # Explicit success: an unset trailing domain would otherwise make the last
  # `if` false and return non-zero, which is fatal under `set -e`.
  return 0
}

# Prints "label=domain" for every configured domain, one per line.
# WHY the label travels with the name: status and preflight label their rows, and an
# empty label would print `DNS [] example.com` — which reads as a bug in the script
# rather than a domain the operator left unset.
_configured_domain_labels() {
  local label domain entry
  for entry in "primary:$DOMAIN_NAME" "admin:$ADMIN_DOMAIN" "oj:$OJ_DOMAIN" "ranking:$RANKING_DOMAIN"; do
    label="${entry%%:*}"
    domain="${entry#*:}"
    if [[ -n "$domain" ]]; then
      printf '%s=%s\n' "$label" "$domain"
    fi
  done
  return 0
}

# Derives CERT_LINEAGE_DOMAIN, ACME_HOST_NAMES and PRIMARY_DOMAIN from whatever is set.
# WHY one place: certbot creates the lineage under the first -d it is handed, every
# vhost reads the certificate from that path, and the :80 vhost has to answer for
# every SAN. All three are consequences of the same configured set, so they are
# computed once here rather than reassembled at each use.
_resolve_domain_targets() {
  PRIMARY_DOMAIN="$DOMAIN_NAME"
  CERT_LINEAGE_DOMAIN="${CERT_LINEAGE_DOMAIN:-$DOMAIN_NAME}"

  local first="" domain
  while read -r domain; do
    [[ -z "$first" ]] && first="$domain"
  done < <(_configured_domains)

  # The lineage belongs to the primary when there is one, since certbot is handed
  # -d "$DOMAIN_NAME" first and names the directory after it.
  [[ -z "$CERT_LINEAGE_DOMAIN" ]] && CERT_LINEAGE_DOMAIN="$first"
  ACME_HOST_NAMES="$(_configured_domains | paste -sd' ' -)"
  [[ -n "$ACME_HOST_NAMES" ]] || ACME_HOST_NAMES="_"
}

# Fails when no domain is configured at all.
# WHY: without one there is no name to issue a certificate for, no server_name to
# route on, and no SAN to validate — every later step would fail in a less obvious
# place, so the setup refuses at the point where the cause is still visible.
_require_at_least_one_domain() {
  if [[ -z "$ACME_HOST_NAMES" || "$ACME_HOST_NAMES" == "_" ]]; then
    log_die "no domain configured — pass at least one of --domain, --admin-domain, --oj-domain, --ranking-domain" 1
  fi
}

# Prints every configured domain as a shell-safe space-separated list, for logs.
_domain_list() {
  # Mirrors build_cert_domains: EXTRA_DOMAINS becomes a SAN entry, so a dry-run
  # preview that omitted them would show fewer names than the real certbot call.
  local domain extra
  local all=()
  while read -r domain; do
    all+=("$domain")
  done < <(_configured_domains)
  for extra in $EXTRA_DOMAINS; do
    all+=("$extra")
  done
  ((${#all[@]} > 0)) || return 0
  printf '%s\n' "${all[@]}" | paste -sd' ' -
}

# ---------------------------------------------------------------------------
# Template block filter
# ---------------------------------------------------------------------------

# Strips regions marked `# @block <name>` … `# @end block` for domains that are not
# configured, so an unset domain never produces an empty server_name. Reads stdin and
# writes stdout, so it composes in the envsubst pipeline.
#
# WHY stripping beats guarding with envsubst: a `${VAR}` that expands to nothing is
# still emitted, and `server_name ;` is a syntax error that takes the whole config
# down — including the vhosts that were fine. Removing the region means the output is
# valid nginx for any subset of the four domains.
_filter_optional_blocks() {
  awk -v enabled_primary="$DOMAIN_NAME" \
      -v enabled_admin="$ADMIN_DOMAIN" \
      -v enabled_oj="$OJ_DOMAIN" \
      -v enabled_ranking="$RANKING_DOMAIN" '
    /^# @block / {
      name = $3
      keep = 1
      if (name == "primary") keep = (enabled_primary != "")
      if (name == "admin")   keep = (enabled_admin   != "")
      if (name == "oj")      keep = (enabled_oj      != "")
      if (name == "ranking") keep = (enabled_ranking != "")
      if (keep) print
      next
    }
    /^# @end block/ { name = ""; keep = 1; next }
    { if (keep || name == "") print }
  '
}

# Announces which of the two concerns this run is scoped to. Emitted only for the
# narrowed scopes, so a bare `setup` logs exactly what it logged before.
_log_setup_scope() {
  if [[ "$SETUP_ISSUE_CERT" == "1" ]] && [[ "$SETUP_RENDER_PROXY" == "0" ]]; then
    log_info "Scope: certificate only — nginx config is neither rendered nor validated"
  elif [[ "$SETUP_ISSUE_CERT" == "0" ]] && [[ "$SETUP_RENDER_PROXY" == "1" ]]; then
    log_info "Scope: proxy only — no certificate store is read, written or issued"
  fi
}

# Puts the certificate store in place. Skipped under the proxy scope, which must not
# create the store it was told not to touch.
_ensure_cert_store_dir() {
  local cert_dir
  cert_dir="$(_cert_store_dir)"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would create directory: $cert_dir"
  else
    mkdir -p "$cert_dir"
    log_info "created $cert_dir"
  fi
}

_issue_certificate() {
  case "$DOMAIN_CERT_METHOD" in
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
      log_die "unknown cert type: $DOMAIN_CERT_METHOD — use letsencrypt, provided, or selfsigned" 1
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Setup subcommand
# ---------------------------------------------------------------------------
# Runs one pass of the domain setup sequence. <issue_certificate> is the
# certificate half, <render_proxy> the nginx half; the three commands are the three
# combinations of those two booleans, so a narrowing is a smaller sequence and
# never a second copy of it.
_run_setup_scope() {
  local issue_certificate="$1" render_proxy="$2"
  _resolve_domain_targets
  _require_at_least_one_domain

  log_info "Domain setup — mode: $([ "$DRY_RUN" -eq 1 ] && echo 'DRY-RUN' || echo 'APPLY')"
  log_info "Configured domains: $(_domain_list)"
  [[ -n "$OJ_DOMAIN" ]] || log_info "OJ domain not set — OJ vhost and SAN omitted"
  log_info "Certificate lineage: $CERT_LINEAGE_DOMAIN"
  log_info "Certificate type: $DOMAIN_CERT_METHOD"
  _log_setup_scope
  _prompt_optional_features
  _log_optional_features
  [[ "$LE_STAGING" == "1" ]] && log_warn "Let's Encrypt STAGING mode — issued certificates are not browser-trusted"

  # WHY the check belongs to the certificate half alone: the email is a
  # certbot registration argument, and the port-80 probe exists because the HTTP-01
  # challenge has to be answerable. Neither has anything to do with writing an
  # nginx config, so `proxy` must not be asked for an email or blocked on :80.
  if [[ "$issue_certificate" == "1" ]] && [[ "$DOMAIN_CERT_METHOD" == "letsencrypt" ]]; then
    [[ -n "$CERT_EMAIL" ]] || log_die "CERT_EMAIL is required for letsencrypt — set env or pass --email" 1
    _preflight_port80
  fi

  # WHY the backup and the store directory are part of the certificate half: both
  # exist for the certificate store, and the proxy half must not even create the
  # directory it was told not to touch.
  if [[ "$issue_certificate" == "1" ]]; then
    _backup_certificates
    _ensure_cert_store_dir
  fi

  # WHY the three nginx steps are gated one at a time rather than as a block: the
  # cert scope drops the render and, with it, the validation that gates that render,
  # while the proxy scope drops only the issuance between them. A block could not
  # express either shape. The order is unchanged, so a bare run renders, issues and
  # validates exactly as it always did.
  [[ "$render_proxy" == "1" ]] && _render_nginx_config

  [[ "$issue_certificate" == "1" ]] && _issue_certificate

  [[ "$render_proxy" == "1" ]] && _validate_nginx_config

  # Explicit success: under the cert scope the last gate above is a false test, so
  # the function would otherwise return non-zero and abort the run at the call site.
  return 0
}

# Ends a setup: the reload belongs to the proxy half and nothing else.
_run_setup_tail() {
  # Reloaded only here: issuance and validation do not, so a plain `setup` still picks
  # up the renewed certificate the same way it did before, from the rendered config.
  if [[ "$SETUP_ISSUE_CERT" == "0" ]] && [[ "$SETUP_RENDER_PROXY" == "1" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      log_info "[dry-run] would reload the running nginx container"
    else
      _reload_running_nginx
    fi
  fi
  _run_auto_renew

  discord_alert "Domain setup completed for $(_domain_list) (cert: ${DOMAIN_CERT_METHOD})" 65280
  log_info "Domain setup complete"
}

# Ends a live run by forcing a renewal, so a config change takes effect on the running
# nginx without a second command.
#
# WHY a dry run only announces it: renewing is the one step here that talks to the ACME
# server, and a preview must not spend a rate-limit slot. It also must not call
# cmd_renew, which opens with its own mode banner and would print a second, unrelated
# header after the setup it belongs to.
#
# WHY the cert-only scope is excluded: cmd_renew ends by reloading nginx, and `cert`
# promises nginx is left alone. A cert-only run that reloaded nginx would break that
# promise, so the flag is honoured only where a reload was already in scope.
_run_auto_renew() {
  [[ "$AUTO_RENEW" == "1" ]] || return 0
  [[ "$SETUP_RENDER_PROXY" == "1" ]] || return 0
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] --auto-renew: would force-renew the certificate for ${CERT_LINEAGE_DOMAIN}"
    return 0
  fi
  # WHY the flag is cleared around the call: cmd_renew has no path back into the setup
  # scope, but a renew that somehow re-entered one would renew again. Clearing it makes
  # the recursion impossible rather than merely unlikely.
  local was_auto_renew="$AUTO_RENEW"
  AUTO_RENEW=0
  cmd_renew
  AUTO_RENEW="$was_auto_renew"
}

# WHY the scope is the command and not a flag: a run either issues a certificate, writes
# nginx config, or both. Spelling that as a flag gave one concern two names, and a flag
# that contradicts the command it narrows is a case that has to be argued about. As verbs
# each scope has exactly one spelling and nothing can contradict anything.
cmd_setup() { _run_setup_scope 1 1; _run_setup_tail; }

cmd_cert() { _run_setup_scope 1 0; _run_setup_tail; }

cmd_proxy() { _run_setup_scope 0 1; _run_setup_tail; }

# ---------------------------------------------------------------------------
# Certificate issuance retry helper
# ---------------------------------------------------------------------------
# Runs <command...> verbatim. With AUTO_RETRY=1 a non-zero exit is retried with
# exponential backoff (doubling, capped at CERT_RETRY_BACKOFF_CAP) until
# CERT_RETRY_ATTEMPTS is reached; CERT_RETRY_ATTEMPTS=0 retries without limit
# (--retry-forever). Without AUTO_RETRY the first failure is returned as-is.
_retry_certbot() {
  local attempt=1 interval="$CERT_RETRY_INTERVAL"

  while :; do
    if "$@"; then
      return 0
    fi
    if [[ "$AUTO_RETRY" -ne 1 ]]; then
      return 1
    fi
    if (( CERT_RETRY_ATTEMPTS > 0 )) && (( attempt >= CERT_RETRY_ATTEMPTS )); then
      log_warn "certificate issuance failed after ${attempt} attempt(s)"
      return 1
    fi
    log_warn "attempt ${attempt}/${CERT_RETRY_ATTEMPTS} failed — retrying in ${interval}s"
    sleep "$interval"
    attempt=$(( attempt + 1 ))
    interval=$(( interval * 2 ))
    (( interval > CERT_RETRY_BACKOFF_CAP )) && interval="$CERT_RETRY_BACKOFF_CAP"
  done
}

# ---------------------------------------------------------------------------
# Certificate argument builders
# ---------------------------------------------------------------------------
# Populates CERT_DOMAINS with a -d for every domain that is actually configured,
# plus any --extra-domains, so certonly and renew build identical SAN lists.
# WHY the emptiness test per domain: passing `-d ""` for an unset domain makes
# certbot request a SAN with no name, which fails validation for the whole
# certificate — not just the missing name. An unconfigured domain has to be absent
# from the command line entirely.
build_cert_domains() {
  CERT_DOMAINS=()
  local domain extra
  while read -r domain; do
    CERT_DOMAINS+=(-d "$domain")
  done < <(_configured_domains)
  for extra in $EXTRA_DOMAINS; do
    CERT_DOMAINS+=(-d "$extra")
  done
  # Explicit success: CERT_DOMAINS must carry at least one -d or certbot is called
  # with no names at all, which fails with an error that names no domain.
  (( ${#CERT_DOMAINS[@]} > 0 )) || log_die "no domain to certify — configure at least one domain" 1
  return 0
}

# Populates CERTBOT_FLAGS with the shared invocation flags. --staging, --force and
# --deploy-hook each append only when requested, so the default call is unchanged.
build_certbot_flags() {
  CERTBOT_FLAGS=(--email "$CERT_EMAIL" --agree-tos --non-interactive)
  [[ "$LE_STAGING" == "1" ]] && CERTBOT_FLAGS+=(--server "$LE_STAGING_DIRECTORY")
  [[ "$FORCE_RENEWAL" == "1" ]] && CERTBOT_FLAGS+=(--force-renewal)
  [[ -n "$DEPLOY_HOOK" ]] && CERTBOT_FLAGS+=(--deploy-hook "$DEPLOY_HOOK")
  # Explicit success: as the last statement, a false [[ ]] above would otherwise
  # become the function's return value and trip `set -e` at the call site.
  return 0
}

# Populates RENEW_FLAGS for `certbot renew`. `--server` and `--email` do not belong
# on renew and are deliberately omitted here.
build_renew_flags() {
  RENEW_FLAGS=(--force-renewal)
  [[ -n "$DEPLOY_HOOK" ]] && RENEW_FLAGS+=(--deploy-hook "$DEPLOY_HOOK")
  return 0
}

# ---------------------------------------------------------------------------
# DNS-01 challenge (optional)
# ---------------------------------------------------------------------------
# Populates DNS_CHALLENGE_ARGS with the certbot flags for DNS-01, and
# DNS_CREDENTIALS_RESOLVED with the credentials file, when DNS_PROVIDER is set.
# WHY the credentials file is generated: certbot's DNS plugins read an ini holding
# an API token, and requiring the operator to hand-write one is the step they skip —
# CLOUDFLARE_API_TOKEN is turned into exactly the file the cloudflare plugin expects.
# An empty DNS_PROVIDER leaves both empty, so the HTTP-01 webroot path is unchanged.
DNS_CHALLENGE_ARGS=()
DNS_CREDENTIALS_RESOLVED=""
_resolve_dns_challenge() {
  DNS_CHALLENGE_ARGS=()
  DNS_CREDENTIALS_RESOLVED=""
  [[ -n "$DNS_PROVIDER" ]] || return 0

  local creds="$DNS_CREDENTIALS_FILE"
  if [[ -z "$creds" && "$DNS_PROVIDER" == "cloudflare" && -n "$CLOUDFLARE_API_TOKEN" ]]; then
    creds="$(_cert_store_dir)/cloudflare.ini"
    if [[ "$DRY_RUN" -eq 0 ]]; then
      mkdir -p "$(dirname -- "$creds")"
      ( umask 077; printf 'dns_cloudflare_api_token = %s\n' "$CLOUDFLARE_API_TOKEN" > "$creds" )
    fi
  fi
  [[ -n "$creds" ]] || log_die "DNS-01 ($DNS_PROVIDER) requires --dns-credentials or CLOUDFLARE_API_TOKEN" 1

  DNS_CREDENTIALS_RESOLVED="$creds"
  DNS_CHALLENGE_ARGS=(--dns-"$DNS_PROVIDER" --dns-"$DNS_PROVIDER"-credentials "$creds")
  return 0
}

# ---------------------------------------------------------------------------
# Port 80 readiness wait
# ---------------------------------------------------------------------------
# Polls the primary host over HTTP until it answers or WAIT_PORT80_TIMEOUT
# elapses. WHY: spending a Let's Encrypt validation attempt on a record or
# forward that is still propagating is what --auto-retry then has to recover
# from, so a bounded wait first usually removes the failure entirely.
_wait_for_port80() {
  local timeout="${WAIT_PORT80_TIMEOUT:-0}" elapsed=0
  (( timeout > 0 )) || return 0

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would wait up to ${timeout}s for port 80 at $CERT_LINEAGE_DOMAIN"
    return 0
  fi

  while (( elapsed < timeout )); do
    if curl -sf -o /dev/null --max-time "$PORT80_PROBE_TIMEOUT_S" "http://${CERT_LINEAGE_DOMAIN}/" 2>/dev/null; then
      log_info "port 80 reachable after ${elapsed}s"
      return 0
    fi
    sleep "$PORT80_POLL_INTERVAL_S"
    elapsed=$(( elapsed + PORT80_POLL_INTERVAL_S ))
  done
  log_warn "port 80 not reachable within ${timeout}s — continuing anyway"
  return 0
}

# ---------------------------------------------------------------------------
# Run lock
# ---------------------------------------------------------------------------
# Serialises runs when --lock is set, so a scheduled renewal and a manual run
# cannot race over the same certificate store.
_acquire_run_lock() {
  [[ "$USE_LOCK" == "1" ]] || return 0
  exec 9>"${REPO_ROOT}/${DOMAIN_LOCK_FILE}"
  if ! flock -n 9; then
    log_die "another run holds ${DOMAIN_LOCK_FILE} — refusing to start" 1
  fi
  log_info "run lock acquired (${DOMAIN_LOCK_FILE})"
}

# ---------------------------------------------------------------------------
# Certificate store helpers
# ---------------------------------------------------------------------------
_cert_store_dir() {
  printf '%s' "${REPO_ROOT}/config/${CERT_DIR_NAME}"
}

# Prints the active fullchain path. certbot writes the live/<lineage>/ layout the
# proxy reads; the flat live/fullchain.pem is accepted only as a legacy fallback,
# since it is where the older provided/self-signed paths used to write.
_cert_fullchain_path() {
  local lineage flat
  lineage="$(_cert_store_dir)/live/${CERT_LINEAGE_DOMAIN}/fullchain.pem"
  flat="$(_cert_store_dir)/live/fullchain.pem"
  if [[ -f "$lineage" ]]; then
    printf '%s' "$lineage"
  elif [[ -f "$flat" ]]; then
    printf '%s' "$flat"
  else
    printf '%s' "$lineage"
  fi
}

_cert_privkey_path() {
  local lineage flat
  lineage="$(_cert_store_dir)/live/${CERT_LINEAGE_DOMAIN}/privkey.pem"
  flat="$(_cert_store_dir)/live/privkey.pem"
  if [[ -f "$lineage" ]]; then
    printf '%s' "$lineage"
  elif [[ -f "$flat" ]]; then
    printf '%s' "$flat"
  else
    printf '%s' "$lineage"
  fi
}

# Prints remaining validity in whole days, or -1 when no certificate is present.
_cert_days_left() {
  local cert_file
  cert_file="$(_cert_fullchain_path)"
  if [[ ! -f "$cert_file" ]]; then
    printf '%s' "-1"; return 0
  fi

  local expiry expiry_epoch now_epoch
  expiry="$(openssl x509 -enddate -noout -in "$cert_file" 2>/dev/null | sed 's/notAfter=//')"
  if [[ -z "$expiry" ]]; then
    printf '%s' "-1"; return 0
  fi
  expiry_epoch="$(date -d "$expiry" +%s 2>/dev/null || date -j -f "%b %d %H:%M:%S %Y %Z" "$expiry" +%s 2>/dev/null || echo 0)"
  now_epoch="$(date +%s)"
  if (( expiry_epoch <= 0 )); then
    printf '%s' "-1"; return 0
  fi
  printf '%s' "$(( (expiry_epoch - now_epoch) / 86400 ))"
}

# ---------------------------------------------------------------------------
# Certificate store backup
# ---------------------------------------------------------------------------
# Snapshots the certificate store before it is modified, then prunes to
# CERT_BACKUP_KEEP. The destination lives inside the gitignored store, so a
# backup can never be committed.
_backup_certificates() {
  [[ "$BACKUP_CERTS" == "1" ]] || return 0
  local src dest stamp
  src="$(_cert_store_dir)"
  if [[ ! -d "$src" ]]; then
    log_info "no certificate store to back up yet"
    return 0
  fi
  # LC_ALL=C keeps the stamp Gregorian on hosts whose locale uses a non-Gregorian
  # calendar (e.g. a Buddhist-era Thai locale), which would otherwise emit a
  # nonsensical year into the directory name.
  stamp="$(LC_ALL=C date -u +%Y%m%dT%H%M%SZ)"
  dest="${src}/backups/${stamp}"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would back up ${src} -> ${dest}"
    return 0
  fi

  mkdir -p "$dest"
  if tar -czf "${dest}/${CERT_DIR_NAME}.tgz" --exclude="${CERT_DIR_NAME}/backups" \
      -C "${REPO_ROOT}/config" "$CERT_DIR_NAME" 2>/dev/null; then
    log_info "certificate backup: ${dest}/${CERT_DIR_NAME}.tgz"
    _prune_cert_backups
  else
    log_warn "certificate backup failed"
  fi
}

_prune_cert_backups() {
  local dir
  dir="$(_cert_store_dir)/backups"
  [[ -d "$dir" ]] || return 0
  ls -1dt "${dir}"/*/ 2>/dev/null | tail -n "+$(( CERT_BACKUP_KEEP + 1 ))" | xargs -r rm -rf
}

# ---------------------------------------------------------------------------
# JSON encoding helper
# ---------------------------------------------------------------------------
_json_escape() {
  local raw="${1:-}"
  raw="${raw//\\/\\\\}"
  printf '%s' "${raw//\"/\\\"}"
}

# ---------------------------------------------------------------------------
# Let's Encrypt setup
# ---------------------------------------------------------------------------
_setup_letsencrypt() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would run certbot certonly for $(_domain_list)"
    return 0
  fi

  build_cert_domains
  build_certbot_flags
  _resolve_dns_challenge

  local cert_dir
  cert_dir="$(_cert_store_dir)"
  mkdir -p "${cert_dir}/www"

  # HTTP-01 only: waiting on :80 is pointless when validation is a TXT record.
  if [[ -z "$DNS_PROVIDER" ]]; then
    _wait_for_port80
  fi

  if ! command -v certbot >/dev/null 2>&1; then
    log_warn "certbot not found on host — attempting via docker"
    _run_certbot_docker
    return
  fi

  # --config-dir points certbot at the store the proxy bind-mounts, so the
  # lineage lands at <store>/live/<domain>/ — the path nginx reads. The former
  # --cert-path/--key-path were no-ops outside `certonly --csr`.
  if [[ -n "$DNS_PROVIDER" ]]; then
    _retry_certbot certbot certonly "${DNS_CHALLENGE_ARGS[@]}" \
      "${CERT_DOMAINS[@]}" "${CERTBOT_FLAGS[@]}" \
      --config-dir "$cert_dir" \
      || log_die "certbot certonly failed" 1
  else
    _retry_certbot certbot certonly --webroot -w "${cert_dir}/www" \
      "${CERT_DOMAINS[@]}" "${CERTBOT_FLAGS[@]}" \
      --config-dir "$cert_dir" \
      || log_die "certbot certonly failed" 1
  fi
  log_info "Let's Encrypt certificates obtained"
}

_run_certbot_docker() {
  local cert_dir
  cert_dir="$(_cert_store_dir)"
  mkdir -p "${cert_dir}/www"
  _resolve_dns_challenge
  # The store root is mounted at /etc/letsencrypt so certbot's lineage appears at
  # <store>/live/<domain>/; mounting <store>/live here (the earlier form) nested
  # a second live/ level and nginx never saw the certificate.
  if [[ -n "$DNS_PROVIDER" ]]; then
    _retry_certbot docker run --rm \
      -v "${cert_dir}:/etc/letsencrypt" \
      -v "${cert_dir}/www:/var/www/certbot" \
      -v "${DNS_CREDENTIALS_RESOLVED}:/etc/letsencrypt/dns-creds.ini:ro" \
      "${CERTBOT_IMAGE:-certbot/dns-$DNS_PROVIDER}" certonly \
      --dns-"$DNS_PROVIDER" --dns-"$DNS_PROVIDER"-credentials /etc/letsencrypt/dns-creds.ini \
      "${CERT_DOMAINS[@]}" "${CERTBOT_FLAGS[@]}" \
      || log_die "certbot docker run failed" 1
  else
    _retry_certbot docker run --rm \
      -v "${cert_dir}:/etc/letsencrypt" \
      -v "${cert_dir}/www:/var/www/certbot" \
      certbot/certbot certonly --webroot -w /var/www/certbot \
      "${CERT_DOMAINS[@]}" "${CERTBOT_FLAGS[@]}" \
      || log_die "certbot docker run failed" 1
  fi
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

  if ! openssl verify -untrusted "$CERT_PATH" "$CERT_PATH" >/dev/null 2>&1; then
    log_warn "certificate failed openssl verify — may not be trusted by clients"
  else
    log_info "certificate passed openssl verify"
  fi

  # The lineage directory nginx reads, not a flat live/ level: nginx requests
  # live/<domain>/fullchain.pem, so a flat copy is invisible to it.
  local dest_dir
  dest_dir="$(_cert_store_dir)/live/${CERT_LINEAGE_DOMAIN}"
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
  local dest_dir
  dest_dir="$(_cert_store_dir)/live/${CERT_LINEAGE_DOMAIN}"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would generate self-signed cert for $CERT_LINEAGE_DOMAIN"
    return 0
  fi

  mkdir -p "$dest_dir"
  openssl req -x509 -nodes -days 365 \
    -newkey rsa:2048 \
    -keyout "${dest_dir}/privkey.pem" \
    -out "${dest_dir}/fullchain.pem" \
    -subj "/CN=${CERT_LINEAGE_DOMAIN}/O=CMS/C=TH" \
    2>/dev/null
  chmod 600 "${dest_dir}/privkey.pem"
  log_info "self-signed certificate generated for $CERT_LINEAGE_DOMAIN"
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
    log_info "[dry-run] domains: $(_domain_list) | lineage: $CERT_LINEAGE_DOMAIN | ACME server_name: $ACME_HOST_NAMES"
    log_info "[dry-run] variables: DOMAIN_NAME=$DOMAIN_NAME HSTS_MAX_AGE=$HSTS_MAX_AGE REDIS_RATE_LIMIT=$REDIS_RATE_LIMIT PER_USER_LIMIT=$PER_USER_LIMIT REDIS_HOST=$REDIS_HOST REDIS_PORT=$REDIS_PORT MONITORING_ENABLED=$MONITORING_ENABLED WAF_ENABLED=$WAF_ENABLED WAF_PORT=$WAF_PORT WAF_PARANOIA=$WAF_PARANOIA WAF_ANOMALY_INBOUND=$WAF_ANOMALY_INBOUND WAF_RULE_ENGINE=$WAF_RULE_ENGINE"
    if [[ "${WAF_ENABLED:-0}" == "1" ]]; then
      log_info "[dry-run] WAF_ENABLED=1 — waf fronting note: grader-waf (OWASP CRS, PARANOIA=$WAF_PARANOIA, ANOMALY_INBOUND=$WAF_ANOMALY_INBOUND, RULE_ENGINE=$WAF_RULE_ENGINE) fronts grader-nginx-proxy via cms-network BACKEND=http://grader-nginx-proxy:80; host port ${WAF_BIND_IP}:${WAF_PORT} → 80 when --profile waf is used. See docs/waf-tuning.md"
    else
      log_info "[dry-run] WAF_ENABLED=0 — WAF disabled, nginx works exactly as before (no waf container, no new ports)"
    fi
    return 0
  fi

  export DOMAIN_NAME ADMIN_DOMAIN OJ_DOMAIN RANKING_DOMAIN HSTS_MAX_AGE
  export CERT_LINEAGE_DOMAIN ACME_HOST_NAMES
  export CONTEST_LISTEN_PORT ADMIN_LISTEN_PORT RANKING_LISTEN_PORT OJ_BACKEND_PORT
  export RANKING_AUTH_DIRECTIVES="${RANKING_AUTH_DIRECTIVES:-}"

  local redis_upstream_block redis_lua_placeholder per_user_login per_user_ranking

  if [[ "${REDIS_RATE_LIMIT:-0}" == "1" ]]; then
    redis_upstream_block=$(cat <<'EOF'
# Redis distributed rate limit — enabled (REDIS_RATE_LIMIT=1)
# Docker DNS resolver for future OpenResty lua-resty-redis (request-time resolution; nginx starts even if redis absent)
resolver 127.0.0.11 valid=10s ipv6=off;
resolver_timeout 3s;
# Upstream deferred to lua request-time connect to avoid startup DNS failure when redis absent
# upstream redis_rate_limit_backend { server __REDIS_BACKEND__ max_fails=2 fail_timeout=10s; }
# Local limit_req remains as primary until OpenResty image with resty.redis is deployed
#
# FAILURE BEHAVIOUR — for NGINX, a Redis outage cannot degrade or block anything,
# because no nginx request path reads Redis. The upstream above is commented out and
# the token bucket below is commented out too, so the rendered config contains no
# `access_by_lua*`, no `lua_shared_dict`, and no redis upstream at all: with
# REDIS_RATE_LIMIT=1 the only redis-related directives emitted are the `resolver`
# lines above. From nginx the container starts, passes `redis-cli ping`, and is never
# contacted.
#
# This answers the fail-open / fail-closed question for nginx: neither. Verified by
# rendering with REDIS_RATE_LIMIT=1 and filtering comments out of the result — zero
# active redis or lua directives. nginx therefore starts normally whether Redis is up
# or down, and nginx-side rate limiting is entirely the local `limit_req` zones.
#
# THE CONTAINER IS NOT GLOBAL — the contest web server does read it, when it is
# configured to (LOGIN_RATE_LIMIT_REDIS_* -> [<server>.captcha]). That reader is the
# Python login failure counter, not nginx, so none of the nginx claims above change.
# Its outage behaviour is the one decided for it: the counters fall back to counting
# in process and the captcha is demanded on every attempt, so an unreachable store
# taxes an attacker rather than lifting the restriction. Do not read the nginx
# fail-open verdict as applying to it.
#
# The commented token bucket is written to fail OPEN if it is ever enabled as-is:
# its guard has no else branch, and ngx.exit(503) sits inside the success branch,
# so an unreachable Redis would skip the check. It also calls require() and
# red:connect() without pcall, so a failure would raise a Lua error (HTTP 500)
# rather than degrade. Fix both before enabling — see docs/waf-tuning.md.
EOF
)
    # Delimiter quoted so the backtick spans in the block stay literal; the one
    # dynamic reference is substituted here.
    redis_upstream_block="${redis_upstream_block//__REDIS_BACKEND__/${REDIS_HOST}:${REDIS_PORT}}"
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
# Restricted to loopback + the inner peer address
location /metrics {
    stub_status;
    allow 127.0.0.1;
    allow ${INNER_IP:-127.0.0.1};
    deny all;
    access_log off;
}
EOF
)
  else
    nginx_metrics_location="# MONITORING_ENABLED=0 — /metrics not exposed (enable with MONITORING_ENABLED=1 and re-run __domain.sh --apply)"
  fi
  export NGINX_METRICS_LOCATION="$nginx_metrics_location"

  _domain_routes_build

  envsubst '${DOMAIN_NAME} ${ADMIN_DOMAIN} ${OJ_DOMAIN} ${RANKING_DOMAIN} ${CERT_LINEAGE_DOMAIN} ${ACME_HOST_NAMES} ${HSTS_MAX_AGE} ${CONTEST_LISTEN_PORT} ${ADMIN_LISTEN_PORT} ${RANKING_LISTEN_PORT} ${OJ_BACKEND_PORT} ${RANKING_AUTH_DIRECTIVES} ${REDIS_UPSTREAM_BLOCK} ${REDIS_LUA_PLACEHOLDER} ${PER_USER_LOGIN_DIRECTIVES} ${PER_USER_RANKING_DIRECTIVES} ${NGINX_METRICS_LOCATION} ${UPSTREAM_BLOCKS} ${PRIMARY_ROUTE_BLOCKS} ${ADMIN_ROUTE_BLOCKS} ${OJ_ROUTE_BLOCKS} ${RANKING_ROUTE_BLOCKS} ${PRIMARY_UPSTREAM}' < "$template" \
    | _filter_optional_blocks > "$output"
  log_info "nginx config rendered: $output (domains: $(_domain_list) | lineage: $CERT_LINEAGE_DOMAIN | REDIS_RATE_LIMIT=${REDIS_RATE_LIMIT} PER_USER_LIMIT=${PER_USER_LIMIT} MONITORING_ENABLED=${MONITORING_ENABLED} WAF_ENABLED=${WAF_ENABLED:-0})"
  if [[ "${WAF_ENABLED:-0}" == "1" ]]; then
    log_info "WAF_ENABLED=1 — grader-waf is fronting grader-nginx-proxy (PARANOIA=${WAF_PARANOIA} ANOMALY_INBOUND=${WAF_ANOMALY_INBOUND} RULE_ENGINE=${WAF_RULE_ENGINE}, host ${WAF_BIND_IP}:${WAF_PORT}→80 when --profile waf up). CAPTCHA remains active alongside WAF."
  else
    log_info "WAF_ENABLED=0 — WAF disabled, nginx unchanged (no waf container, backward compatible)"
  fi
}

# ---------------------------------------------------------------------------
# Nginx config validation
# ---------------------------------------------------------------------------
# The domain proxy by exact container name, or empty when it is down. The contest
# front door is also an nginx container, so "the first nginx one" is the wrong proxy.
_running_domain_proxy() {
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$DOMAIN_PROXY_CONTAINER"; then
    printf '%s' "$DOMAIN_PROXY_CONTAINER"
  fi
}

_validate_nginx_config() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would run nginx -t inside docker"
    return 0
  fi

  local container
  container="$(_running_domain_proxy)"
  if [[ -z "$container" ]]; then
    log_warn "domain proxy (${DOMAIN_PROXY_CONTAINER}) is not running — skipping nginx -t"
    return 0
  fi
  if docker exec "$container" nginx -t 2>&1; then
    log_info "nginx config test passed in $container"
  else
    log_warn "nginx config test failed in $container"
  fi
}

# Reloads the domain proxy so it re-resolves its upstreams: a redeployed backend has a
# new container IP, and nginx caches the old one until it reloads. A proxy that is not
# running is not an error — the rendered config is already on disk.
_reload_running_nginx() {
  local container
  container="$(_running_domain_proxy)"
  [[ -n "$container" ]] || return 0
  docker exec "$container" nginx -s reload 2>/dev/null || log_warn "nginx reload failed"
  log_info "nginx reloaded in $container"
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

  # WHY every configured domain and not just the primary: one certificate carries
  # every SAN, so Let's Encrypt validates each name against :80. A name that does
  # not answer spends one of the 5 failed validations per hour allowed per account
  # and hostname, so all of them are probed up front.
  local domain checked=0
  while read -r domain; do
    checked=$((checked + 1))
    if curl -sf -o /dev/null --max-time 5 "http://${domain}/" 2>/dev/null; then
      log_info "port 80 reachable at $domain"
    else
      log_warn "port 80 may not be reachable at $domain — LE challenge could fail"
    fi
  done < <(_configured_domains)

  (( checked > 0 )) || log_warn "no domain configured — nothing to probe on port 80"
  return 0
}

# ---------------------------------------------------------------------------
# Status subcommand
# ---------------------------------------------------------------------------
cmd_status() {
  _resolve_domain_targets

  if [[ "$JSON_OUTPUT" == "1" ]]; then
    cmd_status_json
    return 0
  fi
  log_info "Domain status for $(_domain_list)"
  _log_optional_features
  echo ""

  # WHY only configured domains are probed: an unset name resolves nowhere and would
  # be reported as NOT RESOLVED, which reads as a DNS fault on the operator's side
  # when in fact they never asked for that name.
  local entry label domain
  while read -r entry; do
    label="${entry%%=*}"; domain="${entry#*=}"
    _status_dns "$domain" "$label"
  done < <(_configured_domain_labels)
  echo ""

  _status_cert_expiry
  echo ""

  _status_renewal_timer
  echo ""

  while read -r entry; do
    label="${entry%%=*}"; domain="${entry#*=}"
    _status_connectivity "$domain" "$label"
  done < <(_configured_domain_labels)
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
  local cert_file cert_expiry days_left
  cert_file="$(_cert_fullchain_path)"
  if [[ ! -f "$cert_file" ]]; then
    log_warn "no certificate found at $cert_file"
    return 0
  fi

  cert_expiry="$(openssl x509 -enddate -noout -in "$cert_file" 2>/dev/null | sed 's/notAfter=//')"
  [[ -n "$cert_expiry" ]] && log_info "Certificate expiry: $cert_expiry"

  days_left="$(_cert_days_left)"
  if (( days_left < 0 )); then
    return 0
  fi
  if (( days_left < 7 )); then
    log_warn "Certificate expires in $days_left days — renew immediately!"
  elif (( days_left < 30 )); then
    log_warn "Certificate expires in $days_left days"
  else
    log_info "Certificate valid for $days_left more days"
  fi
}

_status_renewal_timer() {
  case "$(_renewal_mechanism)" in
    grader-cert-renew.timer) log_info "Renewal timer: grader-cert-renew.timer is enabled" ;;
    certbot.timer)           log_info "Renewal timer: certbot.timer is enabled" ;;
    certbot-container)       log_info "Renewal timer: certbot container is running" ;;
    *)                       log_warn "No renewal mechanism detected (grader-cert-renew.timer, certbot.timer or certbot container)" ;;
  esac
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
# Shared status probes
# ---------------------------------------------------------------------------
# Prints the first resolved address for <host>, or nothing when it does not
# resolve. Each lookup is bounded so a slow or unreachable resolver cannot stall
# a status call.
_resolve_host() {
  local host="$1" lookup_timeout_s=3
  if command -v dig >/dev/null 2>&1; then
    timeout "$lookup_timeout_s" dig +short "$host" 2>/dev/null | head -1 || true
  elif command -v getent >/dev/null 2>&1; then
    timeout "$lookup_timeout_s" getent hosts "$host" 2>/dev/null | head -1 | awk '{print $1}' || true
  fi
  return 0
}

# Prints the detected renewal mechanism: grader-cert-renew.timer, certbot.timer,
# certbot-container or none. WHY grader-cert-renew first: it is the unit this repo
# ships (config/systemd/), and the earlier check only knew certbot.timer, so a
# correctly configured host reported "no renewal mechanism".
_renewal_mechanism() {
  if systemctl is-enabled grader-cert-renew.timer 2>/dev/null | grep -q enabled; then
    printf 'grader-cert-renew.timer'
  elif systemctl is-enabled certbot.timer 2>/dev/null | grep -q enabled; then
    printf 'certbot.timer'
  elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q certbot; then
    printf 'certbot-container'
  else
    printf 'none'
  fi
}

# ---------------------------------------------------------------------------
# JSON status (--json)
# ---------------------------------------------------------------------------
# Emits the same facts as `status` as one JSON object for monitoring. WHY one
# field per check rather than a formatted blob: consumers key on names, not on
# parsing log lines.
cmd_status_json() {
  local dns_json="" host resolved
  # WHY only configured domains: an unset name is emitted as an empty string today,
  # which a consumer reads as "DNS is broken for this name" rather than "not in use".
  # The key stays the domain so existing consumers keep working.
  while read -r host; do
    resolved="$(_resolve_host "$host")"
    dns_json+="\"$(_json_escape "$host")\":\"$(_json_escape "${resolved:-}")\","
  done < <(_configured_domains)
  dns_json="${dns_json%,}"

  local days_left expiry
  days_left="$(_cert_days_left)"
  expiry="$(openssl x509 -enddate -noout -in "$(_cert_fullchain_path)" 2>/dev/null | sed 's/notAfter=//' || true)"

  printf '{"domains":"%s","primary":"%s","dns":{%s},"certificate":{"days_left":%s,"expiry":"%s"},"renewal":"%s"}\n' \
    "$(_json_escape "$(_domain_list)")" "$(_json_escape "$PRIMARY_DOMAIN")" "$dns_json" \
    "$days_left" "$(_json_escape "$expiry")" "$(_renewal_mechanism)"
}

# ---------------------------------------------------------------------------
# Expiry check subcommand
# ---------------------------------------------------------------------------
# Exits non-zero when the certificate is missing or expires within the threshold,
# so a monitor or cron job can alert on it.
cmd_check_expiry() {
  _resolve_domain_targets
  local threshold="${CHECK_EXPIRY_DAYS:-0}" days_left
  (( threshold > 0 )) || threshold="$CHECK_EXPIRY_DAYS_DEFAULT"
  days_left="$(_cert_days_left)"

  if (( days_left < 0 )); then
    log_warn "certificate check failed: no certificate found for ${CERT_LINEAGE_DOMAIN}"
    exit 1
  fi
  if (( days_left < threshold )); then
    log_warn "certificate expires in ${days_left} day(s) — below threshold ${threshold}"
    exit 1
  fi
  log_info "certificate valid for ${days_left} more day(s) (threshold ${threshold})"
}

# ---------------------------------------------------------------------------
# Revoke subcommand
# ---------------------------------------------------------------------------
cmd_revoke() {
  _resolve_domain_targets
  log_info "Certificate revocation — mode: $([ "$DRY_RUN" -eq 1 ] && echo 'DRY-RUN' || echo 'APPLY')"
  local cert_file key_file
  cert_file="$(_cert_fullchain_path)"
  key_file="$(_cert_privkey_path)"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would revoke certificate at ${cert_file} (reason: ${REVOKE_REASON})"
    return 0
  fi
  if [[ ! -f "$cert_file" ]]; then
    log_die "no certificate at ${cert_file} to revoke" 1
  fi
  if ! command -v certbot >/dev/null 2>&1; then
    log_die "certbot not found on host — cannot revoke" 1
  fi

  _retry_certbot certbot revoke --cert-path "$cert_file" --key-path "$key_file" \
    --reason "$REVOKE_REASON" --non-interactive \
    || log_die "certbot revoke failed" 1
  discord_alert "Certificate revoked for ${CERT_LINEAGE_DOMAIN}" 16711680
  log_info "Revocation complete"
}

# ---------------------------------------------------------------------------
# Renew subcommand
# ---------------------------------------------------------------------------
cmd_renew() {
  _resolve_domain_targets
  log_info "Certificate renewal — mode: $([ "$DRY_RUN" -eq 1 ] && echo 'DRY-RUN' || echo 'APPLY')"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would force-renew certificates for $CERT_LINEAGE_DOMAIN"
    return 0
  fi

  _backup_certificates
  build_renew_flags

  if command -v certbot >/dev/null 2>&1; then
    _retry_certbot certbot renew "${RENEW_FLAGS[@]}" --cert-name "$CERT_LINEAGE_DOMAIN" || log_die "certbot renew failed" 1
    log_info "certificates renewed via certbot"
  elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q certbot; then
    local container
    container="$(docker ps --format '{{.Names}}' | grep certbot | head -1)"
    _retry_certbot docker exec "$container" certbot renew "${RENEW_FLAGS[@]}" || log_die "certbot renew failed in container" 1
    log_info "certificates renewed via certbot container ($container)"
  else
    log_die "no certbot found on host or in docker" 1
  fi

  # Reload nginx to pick up new certs
  _reload_running_nginx

  discord_alert "Certificates renewed for ${CERT_LINEAGE_DOMAIN}" 65280
  log_info "Renewal complete"
}

# ---------------------------------------------------------------------------
# Preflight subcommand — 9-check matrix
# ---------------------------------------------------------------------------
cmd_preflight() {
  _resolve_domain_targets
  log_info "Preflight checks for $(_domain_list)"
  _log_optional_features
  echo ""
  local pass=0 warn=0 fail=0

  # 1. SSH LAN
  _check_ssh && { pass=$((pass + 1)); } || { fail=$((fail + 1)); }

  # 2. Tailscale
  _check_tailscale && { pass=$((pass + 1)); } || { fail=$((fail + 1)); }

  # 3. Remote worker RPC
  _check_worker_rpc && { pass=$((pass + 1)); } || { warn=$((warn + 1)); }

  # 4. Database
  _check_database && { pass=$((pass + 1)); } || { fail=$((fail + 1)); }

  # 5. DNS resolution
  _check_dns && { pass=$((pass + 1)); } || { warn=$((warn + 1)); }

  # 6. HTTP port 80
  _check_http80 && { pass=$((pass + 1)); } || { warn=$((warn + 1)); }

  # 7. HTTPS port 443
  _check_https443 && { pass=$((pass + 1)); } || { warn=$((warn + 1)); }

  # 8. Domain paths
  _check_domain_paths && { pass=$((pass + 1)); } || { warn=$((warn + 1)); }

  # 9. Funnel still works
  _check_funnel && { pass=$((pass + 1)); } || { warn=$((warn + 1)); }

  echo ""
  log_info "Preflight results: PASS=$pass  WARN=$warn  FAIL=$fail"
  if (( fail > 0 )); then
    log_warn "Some checks failed — review above output"
    exit 1
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
  # WHY the lineage name and not the primary: when a deployment configures only
  # admin or only ranking, the primary is empty and probing it would report a DNS
  # failure for a name that was never requested. The lineage is by construction a
  # domain that exists.
  printf '  %-30s' "DNS ($CERT_LINEAGE_DOMAIN):"
  if getent hosts "$CERT_LINEAGE_DOMAIN" >/dev/null 2>&1; then
    printf 'PASS\n'
    return 0
  else
    printf 'WARN (not resolved)\n'
    return 1
  fi
}

_check_http80() {
  printf '  %-30s' "HTTP :80 ($CERT_LINEAGE_DOMAIN):"
  if curl -sf -o /dev/null --max-time 5 "http://${CERT_LINEAGE_DOMAIN}/" 2>/dev/null; then
    printf 'PASS\n'
    return 0
  else
    printf 'WARN (unreachable)\n'
    return 1
  fi
}

_check_https443() {
  printf '  %-30s' "HTTPS :443 ($CERT_LINEAGE_DOMAIN):"
  if curl -Ikso /dev/null --max-time 5 "https://${CERT_LINEAGE_DOMAIN}/" 2>/dev/null; then
    printf 'PASS\n'
    return 0
  else
    printf 'WARN (unreachable)\n'
    return 1
  fi
}

_check_domain_paths() {
  printf '  %-30s' "Domain paths:"
  local ok=1 domain checked=0
  while read -r domain; do
    checked=$((checked + 1))
    if ! curl -Ikso /dev/null --max-time 5 "https://${domain}/" 2>/dev/null; then
      ok=0
      break
    fi
  done < <(_configured_domains)

  if [[ "$checked" -eq 0 ]]; then
    printf 'WARN (no domain configured)\n'
    return 1
  fi
  if [[ "$ok" -eq 1 ]]; then
    printf 'PASS (%d domain(s) reachable)\n' "$checked"
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

# WHY the verb narrows the scope before any flag is read: the scope is decided by which
# command was named, not by anything that follows it. A flag could contradict its
# command; a verb cannot.
case "$cmd" in
  cert)  SETUP_ISSUE_CERT=1; SETUP_RENDER_PROXY=0 ;;
  proxy) SETUP_ISSUE_CERT=0; SETUP_RENDER_PROXY=1 ;;
esac

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cert)       DOMAIN_CERT_METHOD="$2"; shift 2 ;;
    --domain)     DOMAIN_NAME="$2"; shift 2 ;;
    --admin-domain) ADMIN_DOMAIN="$2"; shift 2 ;;
    --oj-domain)  OJ_DOMAIN="$2"; shift 2 ;;
    --ranking-domain) RANKING_DOMAIN="$2"; shift 2 ;;
    --cert-path)  CERT_PATH="$2"; shift 2 ;;
    --key-path)   KEY_PATH="$2"; shift 2 ;;
    --email)      CERT_EMAIL="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --apply)      DRY_RUN=0; shift ;;
    --yes|-y)     AUTO_YES=1; shift ;;
    --auto-renew) AUTO_RENEW=1; shift ;;
    --auto-retry) AUTO_RETRY=1; shift ;;
    --retry-attempts) CERT_RETRY_ATTEMPTS="$2"; shift 2 ;;
    --retry-interval) CERT_RETRY_INTERVAL="$2"; shift 2 ;;
    --retry-forever) AUTO_RETRY=1; CERT_RETRY_ATTEMPTS=0; shift ;;
    --extra-domains) EXTRA_DOMAINS="$2"; shift 2 ;;
    --deploy-hook) DEPLOY_HOOK="$2"; shift 2 ;;
    --staging)    LE_STAGING=1; shift ;;
    --force)      FORCE_RENEWAL=1; shift ;;
    --wait-port80) WAIT_PORT80_TIMEOUT="$2"; shift 2 ;;
    --backup-certs) BACKUP_CERTS=1; shift ;;
    --lock)       USE_LOCK=1; shift ;;
    --json)       JSON_OUTPUT=1; shift ;;
    --days)       CHECK_EXPIRY_DAYS="$2"; shift 2 ;;
    --reason)     REVOKE_REASON="$2"; shift 2 ;;
    --dns)        DNS_PROVIDER="$2"; shift 2 ;;
    --dns-credentials) DNS_CREDENTIALS_FILE="$2"; shift 2 ;;
    --config)     CONFIG_FILE="$2"; shift 2 ;;
    --help|-h)    usage; exit 0 ;;
    *)            log_die "unknown option: $1 — see --help" 1 ;;
  esac
done

[[ "$CERT_RETRY_ATTEMPTS" =~ ^[0-9]+$ ]] || log_die "--retry-attempts must be a non-negative integer" 1
[[ "$CERT_RETRY_INTERVAL" =~ ^[0-9]+$ ]] || log_die "--retry-interval must be a non-negative integer" 1
[[ "$WAIT_PORT80_TIMEOUT" =~ ^[0-9]+$ ]] || log_die "--wait-port80 must be a non-negative integer" 1
[[ "$CHECK_EXPIRY_DAYS" =~ ^[0-9]+$ ]] || log_die "--days must be a non-negative integer" 1

_acquire_run_lock

case "$cmd" in
  setup)    cmd_setup ;;
  cert)     cmd_cert ;;
  proxy)    cmd_proxy ;;
  status)   cmd_status ;;
  renew)    cmd_renew ;;
  preflight) cmd_preflight ;;
  check-expiry) cmd_check_expiry ;;
  revoke)   cmd_revoke ;;
  --help|-h|help) usage; exit 0 ;;
  "")       usage; exit 1 ;;
  *)        log_die "unknown command: $cmd — see --help" 1 ;;
esac
