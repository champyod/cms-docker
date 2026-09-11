#!/usr/bin/env bash
set -eu
# pipefail only if available
if (set -o pipefail 2>/dev/null); then
    set -o pipefail
fi

# __config_sync.sh — Generate unified .env from config.toml.
# Replaces the legacy Makefile env: target body.
# Usage: bash scripts/__config_sync.sh [--dry-run] [--no-secrets]

CMS_ROOT="${CMS_DOCKER_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$CMS_ROOT"

TOML_FILE="config.toml"
TOML_EXAMPLE="config.toml.example"
DRY_RUN=0
NO_SECRETS=0

for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=1 ;;
    --no-secrets) NO_SECRETS=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# --- Logging helpers ---
log_info()  { echo "[INFO] $*"; }
log_warn()  { echo "[WARN] $*" >&2; }
log_error() { echo "[ERROR] $*" >&2; }

# --- Secret generators (mirrors Makefile env: target) ---
gen_hex32() { openssl rand -hex 32 2>/dev/null || echo "fallback_$(date +%s)"; }
gen_pw()    { openssl rand -base64 12 2>/dev/null | tr -d "=+/" | cut -c1-16; }

# --- Pure-bash TOML parser: [section] + key = value only ---
# Populates __TOML["section.key"]=value and ordered key arrays per section.
declare -A __TOML
# Explicitly initialized empty: ${#arr[@]} must resolve under `set -u` even
# when a TOML section has no keys.
declare -a __CORE_KEYS=() __ADMIN_KEYS=() __CONTEST_KEYS=() __WORKER_KEYS=() __INFRA_KEYS=() __TAILSCALE_KEYS=() __RPC_KEYS=()

parse_toml() {
  local file="$1" section="" line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Strip inline comments: TOML allows # after values
    line="${line%%#*}"
    [[ -z "${line//[$'\t ']/}" ]] && continue
    line="$(echo "$line" | xargs)"
    if [[ "$line" =~ ^\[([a-zA-Z0-9_]+)\]$ ]]; then
      section="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^([A-Za-z0-9_]+)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      val="${val#\"}"; val="${val%\"}"
      val="${val#\'}"; val="${val%\'}"
      __TOML["${section}.${key}"]="$val"
      case "$section" in
        core)      __CORE_KEYS+=("$key") ;;
        admin)     __ADMIN_KEYS+=("$key") ;;
        contest)   __CONTEST_KEYS+=("$key") ;;
        worker)    __WORKER_KEYS+=("$key") ;;
        infra)     __INFRA_KEYS+=("$key") ;;
        tailscale) __TAILSCALE_KEYS+=("$key") ;;
        rpc)       __RPC_KEYS+=("$key") ;;
      esac
    fi
  done < "$file"
}

is_secret_key() { [[ "$1" =~ (PASSWORD|SECRET|TOKEN|KEY|ENCRYPT) ]]; }

# Returns generated secret value for a given key name, empty if none.
generate_secret_for() {
  local key="$1"
  case "$key" in
    POSTGRES_PASSWORD) gen_pw ;;
    POSTGRES_SERVICE_PASSWORD) gen_pw ;;
    POSTGRES_ADMIN_PASSWORD) gen_pw ;;
    POSTGRES_MONITOR_PASSWORD) gen_pw ;;
    AUTH_SECRET)        gen_hex32 ;;
    SECRET_KEY)          gen_hex32 ;;
    CMS_SECRET_KEY)      gen_hex32 ;;
    RPC_SECRET)          gen_hex32 ;;
    RANKING_PASSWORD)    echo "cms_ranking_$(gen_pw)" ;;
    OFFSITE_ENCRYPT_KEY) gen_hex32 ;;
    GRAFANA_PASSWORD)    gen_hex32 ;;
    VAULT_TOKEN)         gen_hex32 ;;
    HSM_PIN)             gen_hex32 ;;
    CAPTCHA_SECRET_KEY)  gen_hex32 ;;
    *) echo "" ;;
  esac
}

# Write a section block (used inside the unified .env file).
# Args: section_name keys_array_name
write_section_block() {
  local section="$1" keys_arr="$2"
  local -a keys=()
  eval "keys=(\"\${${keys_arr}[@]}\")"

  echo "### [${section}] ###"
  for key in "${keys[@]}"; do
    local val="${__TOML["${section}.${key}"]:-}"
    echo "$key=$val"
  done
  echo ""
}

# Scan one section's keys for empty secret fields and populate them.
# Args: section_name keys_array_name
scan_and_generate_secrets() {
  local section="$1" keys_arr="$2"
  local -a keys=()
  eval "keys=(\"\${${keys_arr}[@]}\")"

  for key in "${keys[@]}"; do
    local full_key="${section}.${key}"
    local val="${__TOML[$full_key]:-}"
    if is_secret_key "$key" && [[ -z "$val" ]]; then
      local gen_val
      gen_val=$(generate_secret_for "$key")
      if [[ -n "$gen_val" ]]; then
        __TOML[$full_key]="$gen_val"
        if [[ "$DRY_RUN" -eq 0 ]]; then
          sed -i "s|^${key} = .*|${key} = \"${gen_val}\"|" "$TOML_FILE"
        else
          echo "Would update config.toml: $key=$gen_val"
        fi
        SECRETS_CHANGED=1
      fi
    fi
  done
}

# WHY: existing deployments miss keys added to config.toml.example because
# bootstrap only copies on first run; secrets for those keys are then never
# generated and downstream .env falls back to defaults. The merge must run
# before secret generation so newly-added empty secrets get populated in
# the same pass. Operator values are never overwritten and the step is
# idempotent.
migrate_missing_keys() {
  # WHY: guard against missing example — corrupted worktrees should not crash sync.
  [[ -f "$TOML_EXAMPLE" ]] || return 0
  [[ -f "$TOML_FILE" ]] || return 0
  declare -A existing_keys
  declare -A existing_sections
  local line sec="" key stripped trimmed
  while IFS= read -r line || [[ -n "$line" ]]; do
    stripped="${line%%#*}"
    trimmed="$(echo "$stripped" | xargs 2>/dev/null || echo "")"
    [[ -z "$trimmed" ]] && continue
    if [[ "$trimmed" =~ ^\[([a-zA-Z0-9_]+)\]$ ]]; then
      sec="${BASH_REMATCH[1]}"
      existing_sections["$sec"]=1
    elif [[ "$trimmed" =~ ^([A-Za-z0-9_]+)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      if [[ -n "$sec" ]]; then
        existing_keys["${sec}.${key}"]=1
      else
        existing_keys["${key}"]=1
      fi
    fi
  done < "$TOML_FILE"
  declare -A missing_by_section
  declare -A missing_count
  declare -a sections_order=()
  declare -A seen_section
  local total=0
  sec=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    stripped="${line%%#*}"
    trimmed="$(echo "$stripped" | xargs 2>/dev/null || echo "")"
    if [[ "$trimmed" =~ ^\[([a-zA-Z0-9_]+)\]$ ]]; then
      sec="${BASH_REMATCH[1]}"
      if [[ -z "${seen_section[$sec]:-}" ]]; then
        sections_order+=("$sec")
        seen_section["$sec"]=1
      fi
      continue
    fi
    if [[ "$trimmed" =~ ^([A-Za-z0-9_]+)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      [[ -z "$sec" ]] && continue
      if [[ -z "${existing_keys[${sec}.${key}]:-}" ]]; then
        local raw
        raw="$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
        [[ -z "$raw" ]] && continue
        if [[ -z "${missing_by_section[$sec]:-}" ]]; then
          missing_by_section["$sec"]="$raw"
        else
          missing_by_section["$sec"]+=$'\n'"$raw"
        fi
        missing_count["$sec"]=$(( ${missing_count["$sec"]:-0} + 1 ))
        total=$((total+1))
        existing_keys["${sec}.${key}"]=1
      fi
    fi
  done < "$TOML_EXAMPLE"
  if [[ "$total" -eq 0 ]]; then
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    local summary=""
    for s in "${sections_order[@]}"; do
      if [[ -n "${missing_by_section[$s]:-}" ]]; then
        summary+="[${s}] ${missing_count[$s]} keys; "
      fi
    done
    log_info "Would migrate $total new config keys: ${summary%"; "}"
    return 0
  fi
  local tmp_new
  tmp_new="$(mktemp)"
  declare -A pending_missing
  for k in "${!missing_by_section[@]}"; do pending_missing["$k"]="${missing_by_section[$k]}"; done
  local prev_sec="" header_sec="" is_header
  while IFS= read -r line || [[ -n "$line" ]]; do
    stripped="${line%%#*}"
    trimmed="$(echo "$stripped" | xargs 2>/dev/null || echo "")"
    is_header=0
    header_sec=""
    if [[ "$trimmed" =~ ^\[([a-zA-Z0-9_]+)\]$ ]]; then
      is_header=1
      header_sec="${BASH_REMATCH[1]}"
    fi
    if [[ "$is_header" -eq 1 ]]; then
      if [[ -n "$prev_sec" && -n "${pending_missing[$prev_sec]:-}" ]]; then
        while IFS= read -r mline || [[ -n "$mline" ]]; do
          echo "$mline" >> "$tmp_new"
        done <<< "${pending_missing[$prev_sec]}"
        unset pending_missing["$prev_sec"]
      fi
      prev_sec="$header_sec"
    fi
    echo "$line" >> "$tmp_new"
  done < "$TOML_FILE"
  if [[ -n "$prev_sec" && -n "${pending_missing[$prev_sec]:-}" ]]; then
    while IFS= read -r mline || [[ -n "$mline" ]]; do
      echo "$mline" >> "$tmp_new"
    done <<< "${pending_missing[$prev_sec]}"
    unset pending_missing["$prev_sec"]
  fi
  for s in "${sections_order[@]}"; do
    if [[ -n "${pending_missing[$s]:-}" ]]; then
      if [[ -z "${existing_sections[$s]:-}" ]]; then
        echo "" >> "$tmp_new"
        echo "[$s]" >> "$tmp_new"
        while IFS= read -r mline || [[ -n "$mline" ]]; do
          echo "$mline" >> "$tmp_new"
        done <<< "${pending_missing[$s]}"
      else
        while IFS= read -r mline || [[ -n "$mline" ]]; do
          echo "$mline" >> "$tmp_new"
        done <<< "${pending_missing[$s]}"
      fi
      unset pending_missing["$s"]
    fi
  done
  cat "$tmp_new" > "$TOML_FILE"
  rm -f "$tmp_new"
  local summary=""
  for s in "${sections_order[@]}"; do
    if [[ -n "${missing_by_section[$s]:-}" ]]; then
      local keys_list
      keys_list="$(echo "${missing_by_section[$s]}" | sed -n 's/^\([A-Za-z0-9_]*\)[[:space:]]*=.*/\1/p' | tr '\n' ' ' | xargs 2>/dev/null || echo "")"
      summary+="[${s}] ${keys_list}; "
    fi
  done
  log_info "migrated $total new config keys: ${summary%"; "}"
}

# --- Main ---
SECRETS_CHANGED=0

main() {
  if [[ ! -f "$TOML_FILE" ]]; then
    if [[ -f "$TOML_EXAMPLE" ]]; then
      cp "$TOML_EXAMPLE" "$TOML_FILE" || { log_error "Failed to copy config.toml.example → config.toml"; exit 1; }
      log_info "Created config.toml from config.toml.example"
      if [[ -t 0 && "$DRY_RUN" -eq 0 ]]; then
        read -r -p "Edit config.toml now? [y/N] " yn || yn="n"
        if [[ "$yn" =~ ^[Yy] ]]; then
          ${EDITOR:-nano} "$TOML_FILE"
        fi
      fi
    else
      log_error "config.toml.example not found — cannot bootstrap"; exit 1
    fi
  fi

  # WHY: merge newly-added example keys into existing config before parsing and
  # secret generation — bootstrap only copies once, so updates would otherwise
  # never reach old worktrees and downstream .env would fallback to defaults.
  migrate_missing_keys

  parse_toml "$TOML_FILE"

  # Ensure ranking config exists from sample (needed for logo_path injection)
  if [[ ! -f "config/cms_ranking.toml" && -f "config/cms_ranking.sample.toml" ]]; then
    cp "config/cms_ranking.sample.toml" "config/cms_ranking.toml" && log_info "Created config/cms_ranking.toml from sample"
  fi

  # Ensure CMS config exists from sample — __inject_config.sh modifies but
  # never creates it, and __config_sync must be self-sufficient on first run.
  if [[ ! -f "config/cms.toml" && -f "config/cms.sample.toml" ]]; then
    cp "config/cms.sample.toml" "config/cms.toml" && log_info "Created config/cms.toml from sample"
  fi

  if [[ "$NO_SECRETS" -eq 0 ]]; then
    scan_and_generate_secrets core    __CORE_KEYS
    scan_and_generate_secrets admin   __ADMIN_KEYS
    scan_and_generate_secrets contest __CONTEST_KEYS
    scan_and_generate_secrets worker  __WORKER_KEYS
    scan_and_generate_secrets infra   __INFRA_KEYS
    scan_and_generate_secrets rpc     __RPC_KEYS

    if [[ "$SECRETS_CHANGED" -eq 1 ]]; then
      log_info "Generated secrets in config.toml"
    fi

    # Re-parse to pick up generated secrets
    if [[ "$DRY_RUN" -eq 0 && "$SECRETS_CHANGED" -eq 1 ]]; then
      __TOML=()
      __CORE_KEYS=(); __ADMIN_KEYS=(); __CONTEST_KEYS=()
      __WORKER_KEYS=(); __INFRA_KEYS=(); __TAILSCALE_KEYS=(); __RPC_KEYS=()
      parse_toml "$TOML_FILE"
    fi
  fi

  # Derived values: CONTEST_DOMAIN → CMS_DOMAIN, DOMAIN_NAME → CMS_DOMAIN
  local cms_domain="${__TOML[core.CMS_DOMAIN]:-cms.local}"
  if [[ -z "${__TOML[contest.CONTEST_DOMAIN]:-}" ]]; then
    __TOML[contest.CONTEST_DOMAIN]="$cms_domain"
  fi
  if [[ -z "${__TOML[infra.DOMAIN_NAME]:-}" ]]; then
    __TOML[infra.DOMAIN_NAME]="$cms_domain"
  fi

  # Write unified .env with section headers for diff readability
  if [[ "$DRY_RUN" -eq 0 ]]; then
    {
      echo "# Auto-generated by ./cms config sync from config.toml."
      echo "# Do not edit directly — edit config.toml instead."
      echo ""
      write_section_block "core"      __CORE_KEYS
      write_section_block "admin"     __ADMIN_KEYS
      write_section_block "contest"   __CONTEST_KEYS
      write_section_block "worker"    __WORKER_KEYS
      write_section_block "infra"     __INFRA_KEYS
      write_section_block "tailscale" __TAILSCALE_KEYS
      write_section_block "rpc"       __RPC_KEYS
    } > .env
    chmod 600 .env
  else
    echo "Would write unified .env from config.toml (all sections)"
  fi

  if [[ "$DRY_RUN" -eq 0 ]]; then
    local db_user="${__TOML[core.POSTGRES_USER]:-cmsuser}"
    local db_pass="${__TOML[core.POSTGRES_PASSWORD]:-}"
    local db_name="${__TOML[core.POSTGRES_DB]:-cmsdb}"
    local db_port="${__TOML[core.POSTGRES_PORT]:-5432}"
    local auth_secret="${__TOML[admin.AUTH_SECRET]:-}"
    # WHY: admin panel uses least-privilege cms_admin; keep owner fallback when secret not yet generated.
    local admin_db_user="cms_admin"
    local admin_db_pass="${__TOML[core.POSTGRES_ADMIN_PASSWORD]:-}"
    if [[ -z "$admin_db_pass" ]]; then
      admin_db_user="$db_user"
      admin_db_pass="$db_pass"
    fi
    {
      echo "# Auto-generated by ./cms config sync from config.toml."
      echo "DATABASE_URL=\"postgresql://${admin_db_user}:${admin_db_pass}@localhost:${db_port}/${db_name}\""
      [[ -n "$auth_secret" ]] && echo "AUTH_SECRET=${auth_secret}"
    } > admin-panel/.env
    chmod 600 admin-panel/.env
  else
    echo "Would write admin-panel/.env: DATABASE_URL=postgresql://..."
  fi

  # Sync ranking logo from RANKING_LOGO_PATH into ranking volume (hot-swap, no waste)
  sync_ranking_logo() {
    local src="${__TOML[admin.RANKING_LOGO_PATH]:-}"
    [[ -z "$src" ]] && { log_info "RANKING_LOGO_PATH empty — skipping logo sync (fallback static logo)"; return 0; }
    src="${src/#\~/$HOME}"
    [[ "$src" != /* ]] && src="$CMS_ROOT/$src"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "Would sync ranking logo: $src → ranking volume logo.* (overwrite, cleanup old)"
      return 0
    fi
    if [[ ! -f "$src" ]]; then
      log_warn "RANKING_LOGO_PATH file not found: $src — skipping logo sync"
      return 0
    fi
    local ext="${src##*.}"
    ext="$(echo "$ext" | tr '[:upper:]' '[:lower:]')"
    [[ "$ext" == "jpeg" ]] && ext="jpg"
    case "$ext" in
      png|jpg|gif|bmp) ;;
      *) log_warn "RANKING_LOGO_PATH unsupported extension '.$ext' (allowed: png/jpg/gif/bmp) — skipping"; return 0 ;;
    esac
    local size
    size="$(stat -c%s "$src" 2>/dev/null || stat -f%z "$src" 2>/dev/null || echo 0)"
    if [[ "$size" -gt 5242880 ]]; then
      log_warn "Logo file too large ($size bytes > 5MB) — skipping"
      return 0
    fi
    local dest_name="logo.${ext}"
    local ranking_lib_dir="${__TOML[admin.CMS_RANKING_LIB_DIR]:-/var/local/lib/cms/ranking}"
    log_info "Syncing ranking logo: $src → $ranking_lib_dir/$dest_name (hot-swap)"
    # Prefer docker cp when ranking container is running (no root, no mountpoint)
    local container="cms-ranking-web-server"
    local tmp_cleanup=()
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$container"; then
      # Remove old logo.* inside container, then copy new (overwrite, no waste)
      docker exec "$container" sh -c "rm -f $ranking_lib_dir/logo.png $ranking_lib_dir/logo.jpg $ranking_lib_dir/logo.gif $ranking_lib_dir/logo.bmp 2>/dev/null; mkdir -p $ranking_lib_dir" 2>/dev/null || true
      if docker cp "$src" "$container:$ranking_lib_dir/$dest_name" 2>/dev/null; then
        # Ensure other extensions removed (only new ext remains)
        docker exec "$container" sh -c "for f in $ranking_lib_dir/logo.png $ranking_lib_dir/logo.jpg $ranking_lib_dir/logo.gif $ranking_lib_dir/logo.bmp; do [ \"\$f\" = \"$ranking_lib_dir/$dest_name\" ] || rm -f \"\$f\"; done" 2>/dev/null || true
        log_info "Logo hot-swapped via docker cp into $container:$ranking_lib_dir/$dest_name (old logo.* cleaned)"
      else
        log_warn "docker cp failed — trying volume mountpoint fallback"
      fi
    fi
    # Fallback: write via helper container to ranking volume (no root, no mountpoint)
    if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$container" || ! docker exec "$container" test -f "$ranking_lib_dir/$dest_name" 2>/dev/null; then
      if docker info >/dev/null 2>&1; then
        docker volume create cms-ranking-data >/dev/null 2>&1 || true
        local src_dir src_base
        src_dir="$(dirname "$src")"
        src_base="$(basename "$src")"
        # Use alpine helper to copy and cleanup old extensions (single overwrite, no waste)
        if docker run --rm -v cms-ranking-data:/data -v "$src_dir:/src:ro" alpine sh -c "rm -f /data/logo.png /data/logo.jpg /data/logo.gif /data/logo.bmp 2>/dev/null; cp /src/$src_base /data/$dest_name && chmod 644 /data/$dest_name && ls -lh /data/$dest_name" 2>/dev/null; then
          log_info "Logo synced via helper container to volume cms-ranking-data:/data/$dest_name (old logo.* cleaned)"
        else
          # Fallback: try mountpoint if helper fails (e.g., no alpine image)
          local mp
          mp="$(docker volume inspect cms-ranking-data --format '{{.Mountpoint}}' 2>/dev/null || echo "")"
          if [[ -n "$mp" && -d "$mp" && -w "$mp" ]]; then
            rm -f "$mp"/logo.png "$mp"/logo.jpg "$mp"/logo.gif "$mp"/logo.bmp 2>/dev/null || true
            cp "$src" "$mp/$dest_name" && chmod 644 "$mp/$dest_name"
            log_info "Logo synced via volume mountpoint $mp/$dest_name (helper fallback)"
          else
            log_warn "Helper container copy failed — run 'docker compose up -d ranking-web-server' will still see logo on next start if volume persists"
          fi
        fi
      else
        log_warn "Docker daemon not reachable — logo staged, will sync when docker available"
      fi
    fi
    # Hot-swap is filesystem-based; RWS ImageHandler picks new file on next /logo request (no restart needed, mtime used for caching)
    log_info "Logo sync done — refresh Ranking page (hard reload) to verify /logo"
  }
  sync_ranking_logo || log_warn "Logo sync encountered issues (non-fatal)"

  # Run config injection (generates config/cms.toml)
  if [[ "$DRY_RUN" -eq 0 ]]; then
    log_info "Running config injection..."
    set -a; source .env 2>/dev/null || true; set +a
    if [[ -f scripts/__inject_config.sh ]]; then
      bash scripts/__inject_config.sh || { log_error "Config injection failed"; exit 1; }
    else
      log_warn "__inject_config.sh not found — skipping cms.toml generation"
    fi
  else
    echo "Would run: bash scripts/__inject_config.sh"
  fi

  # Ensure backups/.gitkeep exists (monitor mount needs host dir)
  if [[ "$DRY_RUN" -eq 0 ]]; then
    mkdir -p backups && touch backups/.gitkeep
  fi

  if [[ "$DRY_RUN" -eq 0 ]]; then
    local total_vars=$((${#__CORE_KEYS[@]} + ${#__ADMIN_KEYS[@]} + \
                        ${#__CONTEST_KEYS[@]} + ${#__WORKER_KEYS[@]} + ${#__INFRA_KEYS[@]} + \
                        ${#__TAILSCALE_KEYS[@]} + ${#__RPC_KEYS[@]}))
    chmod 600 .env admin-panel/.env 2>/dev/null || true
    log_info "Synced ${total_vars} vars from config.toml → .env"
  fi

  if [[ "$DRY_RUN" -eq 0 ]] && [[ -f scripts/__preflight.sh ]]; then
    log_info "Running preflight checks..."
    bash scripts/__preflight.sh || log_warn "Preflight reported issues"
  fi
}

main
