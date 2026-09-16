#!/usr/bin/env bash
# scripts/__secrets-rotate.sh — Secrets audit, generation, and rotation.
#
# Scans .env files for weak/default secrets, generates new credentials,
# and applies them with stack restarts. Never rotates without explicit --apply.
#
# Alternative: HashiCorp Vault (optional, VAULT_ENABLED=0) — see config.toml.example [infra] VAULT_*
#   Vault provides auto-rotation + audit via hashicorp/vault:1.15 (--profile vault)
#   This script works without Vault; Vault is opt-in, disabled by default, local overrides gitignored via .env.local
#
# Usage:
#   __secrets-rotate.sh --audit              list weak secrets (read-only)
#   __secrets-rotate.sh --generate --out .env.new   create new credentials
#   __secrets-rotate.sh --apply              overwrite .env files + restart stacks
#   Vault alternative: VAULT_ENABLED=1 docker compose -f docker-compose.vault.yml --profile vault up -d

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
# Helpers
# ---------------------------------------------------------------------------
env_val() {
  local file="$1" key="$2" raw
  raw="$(awk -F= -v k="$key" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$file" 2>/dev/null || true)"
  env_unquote "$raw"
}

is_weak_secret() {
  local value="$1"
  [[ -z "$value" ]] && return 0
  case "$value" in
    cmspassword|usern4me|passw0rd|8e045a51e4b102ea803c06f92841a1fb|DEFAULT_SECRET_KEY) return 0 ;;
  esac
  [[ "$value" == CHANGE_ME* ]] && return 0
  [[ "$value" == YOUR_* ]] && return 0
  [[ "$value" == *PASSWORD_HERE* ]] && return 0
  [[ "$value" == *GENERATE_WITH* ]] && return 0
  return 1
}

is_default_htpasswd() {
  local file="$1"
  [[ ! -f "$file" ]] && return 0
  local content
  content="$(cat "$file" 2>/dev/null)"
  [[ -z "$content" ]] && return 0
  [[ "$content" == *"admin:admin"* ]] && return 0
  return 1
}

# ---------------------------------------------------------------------------
# Load environment
# ---------------------------------------------------------------------------
if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env" 2>/dev/null || true
  set +a
fi

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
Usage: __secrets-rotate.sh <mode> [options]

Modes:
  --audit                 List weak/default secrets in .env files (read-only)
  --generate --out FILE   Generate new secrets and write to FILE
  --apply                 Overwrite .env files and restart Docker stacks

Options:
  --out <file>            Output file for --generate (default: .env.new)
  --help                  Show this help

Audited secrets:
  - POSTGRES_PASSWORD (.env) — both file + inline
  - RANKING_PASSWORD (.env)
  - CMS_SECRET_KEY (.env / cms.toml)
  - AUTH_SECRET (.env)
  - SECRET_KEY (admin-panel/.env)
  - AUTH_SECRET (admin-panel/.env)
  - funnel.htpasswd (config/funnel.htpasswd)
  - htpasswd_rws (config/htpasswd_rws)

Warning: --apply checks remote worker reference (WORKER / CORE_SERVICES_HOST)
and warns if rotation would break RPC to 100.75.203.112.
EOF
}

# ---------------------------------------------------------------------------
# Audit subcommand
# ---------------------------------------------------------------------------
cmd_audit() {
  log_info "Secrets audit — scanning .env files and config"
  echo ""
  local weak=0 total=0

  # POSTGRES_PASSWORD in .env
  _audit_env_key ".env" "POSTGRES_PASSWORD" && ((weak++))
  ((total++))

  # RANKING_PASSWORD in .env
  _audit_env_key ".env" "RANKING_PASSWORD" && ((weak++))
  ((total++))

  # AUTH_SECRET in .env
  _audit_env_key ".env" "AUTH_SECRET" && ((weak++))
  ((total++))

  # AUTH_SECRET in admin-panel/.env
  if [[ -f "admin-panel/.env" ]]; then
    _audit_env_file_key "admin-panel/.env" "AUTH_SECRET" && ((weak++))
    ((total++))
  fi

  # SECRET_KEY in admin-panel/.env
  if [[ -f "admin-panel/.env" ]]; then
    _audit_env_file_key "admin-panel/.env" "SECRET_KEY" && ((weak++))
    ((total++))
  fi

  # CMS_SECRET_KEY in cms.toml
  if [[ -f "config/cms.toml" ]]; then
    local val
    val="$(grep -oP 'CMS_SECRET_KEY\s*=\s*\K.*' config/cms.toml 2>/dev/null || true)"
    if is_weak_secret "$val"; then
      log_warn "WEAK: CMS_SECRET_KEY in config/cms.toml is default/empty"
      ((weak++))
    else
      log_info "OK:   CMS_SECRET_KEY in config/cms.toml"
    fi
    ((total++))
  fi

  # funnel.htpasswd
  if is_default_htpasswd "config/funnel.htpasswd"; then
    log_warn "WEAK: config/funnel.htpasswd has default or missing credentials"
    ((weak++))
  else
    log_info "OK:   config/funnel.htpasswd"
  fi
  ((total++))

  # htpasswd_rws
  if is_default_htpasswd "config/htpasswd_rws"; then
    log_warn "WEAK: config/htpasswd_rws has default or missing credentials"
    ((weak++))
  else
    log_info "OK:   config/htpasswd_rws"
  fi
  ((total++))

  echo ""
  log_info "Audit complete: $weak weak out of $total checked"

  # Remote worker RPC warning
  _check_remote_worker_ref

  if (( weak > 0 )); then
    log_warn "Run --generate --out .env.new to create new secrets, then --apply to deploy"
  fi
}

_audit_env_key() {
  local file="$1" key="$2"
  local val
  val="$(env_val "$file" "$key" 2>/dev/null)"
  if is_weak_secret "$val"; then
    log_warn "WEAK: $key in $file — default/placeholder value"
    return 0
  elif [[ -n "$val" ]]; then
    log_info "OK:   $key in $file"
    return 1
  else
    log_warn "MISSING: $key in $file"
    return 0
  fi
}

_audit_env_file_key() {
  local file="$1" key="$2"
  local val raw
  raw="$(awk -F= -v k="$2" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$file" 2>/dev/null || true)"
  val="$(env_unquote "$raw")"
  if is_weak_secret "$val"; then
    log_warn "WEAK: $key in $file — default/placeholder value"
    return 0
  elif [[ -n "$val" ]]; then
    log_info "OK:   $key in $file"
    return 1
  else
    log_warn "MISSING: $key in $file"
    return 0
  fi
}

# ---------------------------------------------------------------------------
# Remote worker reference check
# ---------------------------------------------------------------------------
_check_remote_worker_ref() {
  echo ""
  log_info "Remote worker RPC check"
  local worker_host="${WORKER_HOST:-100.75.203.112}"

  # Check if WORKER entries reference remote host
  local remote_refs=0
  if [[ -f ".env" ]]; then
    local matches
    matches="$(grep -c "$worker_host" ".env" 2>/dev/null || true)"
    if (( matches > 0 )); then
      log_warn "  .env references $worker_host ($matches lines) — rotation may break RPC"
      remote_refs=1
    fi
  fi

  # Check CORE_SERVICES_HOST
  if [[ -n "${CORE_SERVICES_HOST:-}" ]]; then
    if [[ "$CORE_SERVICES_HOST" == *"$worker_host"* ]]; then
      log_warn "  CORE_SERVICES_HOST points to $worker_host — rotation requires worker update"
      remote_refs=1
    fi
  fi

  if [[ "$remote_refs" -eq 0 ]]; then
    log_info "  No remote worker references found — rotation is safe"
  else
    log_warn "  After rotation, update worker on $worker_host with new credentials"
    log_warn "  SSH to $worker_host and update config.toml, then: cd /path/to/cms && ./cms config sync && make worker"
  fi
}

# ---------------------------------------------------------------------------
# Generate subcommand
# ---------------------------------------------------------------------------
cmd_generate() {
  local outfile="${GENERATE_OUT:-.env.new}"

  log_info "Generating new secrets to $outfile"

  # Generate secrets
  local postgres_password ranking_password cms_secret auth_secret secret_key
  postgres_password="$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)"
  ranking_password="$(openssl rand -base64 12 | tr -dc 'a-zA-Z0-9' | head -c 16)"
  cms_secret="$(openssl rand -hex 32)"
  auth_secret="$(openssl rand -hex 32)"
  secret_key="$(openssl rand -hex 32)"

  # Generate htpasswd
  local htpasswd_hash=""
  local funnel_user="${FUNNEL_USER:-admin}"
  local funnel_pass
  funnel_pass="$(openssl rand -base64 12 | tr -dc 'a-zA-Z0-9' | head -c 16)"

  if command -v openssl >/dev/null 2>&1; then
    htpasswd_hash="$(openssl passwd -apr1 "$funnel_pass" 2>/dev/null || true)"
  fi

  # Write output
  cat > "$outfile" <<SECRETS
# Generated secrets — $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Review these values, then run: ./cms secrets rotate

# Database password (.env)
POSTGRES_PASSWORD=${postgres_password}

# Ranking password (.env)
RANKING_PASSWORD=${ranking_password}

# CMS secret key (config/cms.toml)
CMS_SECRET_KEY=${cms_secret}

# Next.js admin panel secrets (.env + admin-panel/.env)
AUTH_SECRET=${auth_secret}
SECRET_KEY=${secret_key}

# Funnel htpasswd credentials
FUNNEL_USER=${funnel_user}
FUNNEL_PASS=${funnel_pass}
SECRETS

  # Generate htpasswd file if possible
  if [[ -n "$htpasswd_hash" ]]; then
    echo "${funnel_user}:${htpasswd_hash}" > "${outfile}.htpasswd"
    log_info "htpasswd written to ${outfile}.htpasswd"
  else
    log_warn "openssl passwd unavailable — cannot generate htpasswd"
  fi

  chmod 600 "$outfile"
  [[ -f "${outfile}.htpasswd" ]] && chmod 600 "${outfile}.htpasswd"

  log_info "New secrets generated in $outfile"
  log_info "Review the file, then apply with: --apply"
}

# ---------------------------------------------------------------------------
# Apply subcommand
# ---------------------------------------------------------------------------
cmd_apply() {
  log_info "Applying secret rotation"
  echo ""

  # Require confirmation
  if [[ -t 0 ]]; then
    read -r -p "This will overwrite secrets in .env files and restart stacks. Continue? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[Yy] ]]; then
      log_info "Aborted"
      return 0
    fi
  fi

  local secrets_file="${GENERATE_OUT:-.env.new}"
  if [[ ! -f "$secrets_file" ]]; then
    log_die "secrets file not found: $secrets_file — run --generate first" 1
  fi

  # Source generated secrets
  # shellcheck disable=SC1091
  source "$secrets_file" 2>/dev/null || true

  # Update config.toml with new secrets, then re-run sync
  local toml_updated=0
  if [[ -n "${POSTGRES_PASSWORD:-}" ]]; then
    _update_config_toml "POSTGRES_PASSWORD" "$POSTGRES_PASSWORD" && toml_updated=1
  fi
  if [[ -n "${RANKING_PASSWORD:-}" ]]; then
    _update_config_toml "RANKING_PASSWORD" "$RANKING_PASSWORD" && toml_updated=1
  fi
  if [[ -n "${AUTH_SECRET:-}" ]]; then
    _update_config_toml "AUTH_SECRET" "$AUTH_SECRET" && toml_updated=1
  fi
  if [[ -n "${CMS_SECRET_KEY:-}" ]]; then
    _update_config_toml "CMS_SECRET_KEY" "$CMS_SECRET_KEY" && toml_updated=1
  fi

  # Update admin-panel/.env — AUTH_SECRET, SECRET_KEY (separate consumer)
  if [[ -f "admin-panel/.env" ]]; then
    [[ -n "${AUTH_SECRET:-}" ]] && _update_env_file_key "admin-panel/.env" "AUTH_SECRET" "$AUTH_SECRET"
    [[ -n "${SECRET_KEY:-}" ]] && _update_env_file_key "admin-panel/.env" "SECRET_KEY" "$SECRET_KEY"
  fi

  # Update htpasswd
  if [[ -f "${secrets_file}.htpasswd" ]]; then
    cp -f "${secrets_file}.htpasswd" config/funnel.htpasswd
    chmod 600 config/funnel.htpasswd
    log_info "Updated config/funnel.htpasswd"
  fi

  # Regenerate .env from config.toml
  if [[ "$toml_updated" -eq 1 ]] && [[ -f "scripts/__config_sync.sh" ]]; then
    log_info "Regenerating .env via config sync"
    bash scripts/__config_sync.sh || log_warn "config sync failed — manual intervention may be needed"
  fi

  # Restart core stack (database needs new password)
  log_info "Restarting core stack..."
  make core 2>/dev/null || log_warn "core stack restart failed"

  # Restart admin stack (AUTH_SECRET change needs restart)
  log_info "Restarting admin stack..."
  make admin 2>/dev/null || log_warn "admin stack restart failed"

  # Restart contest stack
  log_info "Restarting contest stack..."
  make contest 2>/dev/null || log_warn "contest stack restart failed"

  # Restart funnel/proxy
  log_info "Restarting contest proxy..."
  make contest 2>/dev/null || true

  echo ""
  _check_remote_worker_ref

  log_info "Secret rotation applied — verify services are healthy with: ./cms status"
  log_info "IMPORTANT: Update worker on 100.75.203.112 if RPC is configured"
}

_update_config_toml() {
  local key="$1" value="$2" toml="${REPO_ROOT}/config.toml"
  if [[ ! -f "$toml" ]]; then
    log_warn "config.toml not found — cannot update $key"
    return 1
  fi
  # Update existing key across all sections (sed matches key = anywhere)
  if grep -q "^${key}\s*=" "$toml"; then
    sed -i "s|^${key}\s*=.*|${key} = \"${value}\"|" "$toml"
    log_info "Updated $key in config.toml"
    return 0
  else
    log_warn "$key not found in config.toml — cannot update"
    return 1
  fi
}

_update_env_file_key() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
    log_info "Updated $key in $file"
  else
    echo "${key}=${value}" >> "$file"
    log_info "Added $key to $file"
  fi
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
MODE=""
GENERATE_OUT=".env.new"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --audit)    MODE="audit"; shift ;;
    --generate) MODE="generate"; shift ;;
    --apply)    MODE="apply"; shift ;;
    --out)      GENERATE_OUT="$2"; shift 2 ;;
    --help|-h)  usage; exit 0 ;;
    *)          log_die "unknown option: $1 — see --help" 1 ;;
  esac
done

case "$MODE" in
  audit)    cmd_audit ;;
  generate) cmd_generate ;;
  apply)    cmd_apply ;;
  "")       usage; exit 1 ;;
  *)        log_die "unknown mode: $MODE" 1 ;;
esac
