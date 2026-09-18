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
# The one env file compose and the scripts read; see migrate_split_env_files below.
MERGED_ENV=".env"
DRY_RUN=0
NO_SECRETS=0

for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=1 ;;
    --no-secrets) NO_SECRETS=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"
log_error() { printf '[ERROR] %s\n' "$*" >&2; }

# --- Secret generators (mirrors Makefile env: target) ---
gen_hex32() { openssl rand -hex 32 2>/dev/null || echo "fallback_$(date +%s)"; }
gen_pw()    { openssl rand -base64 12 2>/dev/null | tr -d "=+/" | cut -c1-16; }

# --- .env value quoting ---
# Emit a value that survives every reader of the generated .env. There are three
# kinds of reader and they do not agree on anything except that ONE layer of
# quoting is removed:
#   1. shell        — `set -a; . ./.env` (Makefile, scripts, cms): splits unquoted
#                     values on whitespace, expands `$` and backticks, eats `\`,
#                     and truncates nothing at `#`.
#   2. docker       — `docker compose --env-file .env`: compose-go's dotenv parser
#                     strips quotes, expands `$` in unquoted/double-quoted values,
#                     cuts unquoted values at " #", and decodes \n \r \t \$ \" \\
#                     in double-quoted values only.
#   3. raw readers  — grep/cut/awk (Makefile DEPLOYMENT_TYPE, __inject_config.sh,
#                     __apply_sql.sh, ...): see the file bytes, nothing else.
# WHY an unquoted value is the defect: `FUNNEL_REALM=CMS restricted` sources as a
# temporary assignment prefixed to the command `restricted`, so the command is not
# found and FUNNEL_REALM is left UNSET (the value silently disappears); `$`, `#`,
# `"` and `\` are mangled by the shell or by compose in the same way. A credential
# with a space has no default to fall back on, so it is lost entirely.
#
# WHY this shape (quote only when needed):
#   * values made only of the characters below stay BARE, so every raw reader that
#     never learned about quoting keeps returning exactly the value it used to;
#   * anything else is SINGLE-quoted, which is literal for the shell AND for compose
#     (compose expands `$` only in unquoted/double-quoted values), so the bytes can
#     be reproduced exactly and a raw reader only has to drop one quote layer;
#   * single quotes cannot express a value that contains `'`, nor one that ends in
#     `\` (compose reads `\'` inside single quotes as an escaped quote and never
#     terminates the string), so those fall through to DOUBLE quotes with escapes
#     that both the shell and compose decode identically.
# KNOWN LIMIT: compose does not decode `\``, so a value that contains BOTH a
# backtick and (`'` or a trailing `\`) cannot round-trip for compose and the shell
# at once; the shell-correct form is written (the file is sourced far more often
# than it is handed to compose) and compose reports it rather than silently
# accepting a different value.
env_quote() {
  local v="${1-}"
  [[ -z "$v" ]] && return 0
  if [[ "$v" =~ ^[A-Za-z0-9_./:@%+,-]+$ ]]; then
    printf '%s' "$v"
    return 0
  fi
  # Single quotes are literal for both readers, but cannot express a value that
  # contains `'` or that ends in `\` (see the KNOWN LIMIT note above).
  case "$v" in
    *"'"*|*\\)
      # Not representable in single quotes — fall through to double quotes below.
      ;;
    *)
      printf "'%s'" "$v"
      return 0
      ;;
  esac
  v="${v//\\/\\\\}"
  v="${v//\"/\\\"}"
  v="${v//\$/\\\$}"
  v="${v//\`/\\\`}"
  printf '"%s"' "$v"
}

# --- Pure-bash TOML parser: [section] + key = value only ---
# Populates __TOML["section.key"]=value and ordered key arrays per section.
declare -A __TOML
# Explicitly initialized empty: ${#arr[@]} must resolve under `set -u` even
# when a TOML section has no keys.
declare -a __CORE_KEYS=() __ADMIN_KEYS=() __CONTEST_KEYS=() __WORKER_KEYS=() __INFRA_KEYS=() __TAILSCALE_KEYS=() __RPC_KEYS=()

# Trim surrounding whitespace (and a CR from a CRLF worktree) off one TOML line.
# WHY not `xargs` (the previous trimming): xargs applies its own quote and backslash
# processing and dies on an unbalanced quote, so a line whose value contains `#`
# (whose tail is stripped before detection) could disappear entirely and its key be
# considered missing and migrated in a second time.
toml_trim() {
  local s="${1%$'\r'}"
  s="${s#"${s%%[![:space:]]*}"}"
  printf '%s' "${s%"${s##*[![:space:]]}"}"
}

# Extract the value from a `key = value` line that has already been trimmed.
# WHY this exists instead of `${line%%#*}` + quote stripping: TOML allows `#`, spaces
# and backslashes INSIDE a quoted string, so a blind `#` cut truncates a legitimate
# value (`KEY = "value # not a comment"`) and the old strip-the-outer-quotes step left
# the escaped form intact. Values are decoded far enough to round-trip: `\"` and `\\`
# inside a TOML basic string (the only escapes needed to express a `"` or a `\`), an
# unquoted value cut at a real inline comment, and a TOML literal string verbatim.
toml_value() {
  local raw="$1" out="" ch rest
  if [[ "$raw" == '"'* ]]; then
    rest="${raw#\"}"
    while [[ -n "$rest" ]]; do
      ch="${rest:0:1}"
      rest="${rest:1}"
      case "$ch" in
        '"') break ;;
        \\)
          case "${rest:0:1}" in
            '"') out+='"'; rest="${rest:1}" ;;
            \\) out+="\\"; rest="${rest:1}" ;;
            *) out+="\\" ;;
          esac
          ;;
        *) out+="$ch" ;;
      esac
    done
  elif [[ "$raw" == "'"* ]]; then
    out="${raw#\'}"
    out="${out%%\'*}"
  else
    out="$(toml_trim "${raw%%#*}")"
  fi
  printf '%s' "$out"
}

parse_toml() {
  local file="$1" section="" line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="$(toml_trim "$line")"
    [[ -z "$line" || "$line" == '#'* ]] && continue
    if [[ "$line" =~ ^\[([a-zA-Z0-9_]+)\][[:space:]]*(#.*)?$ ]]; then
      section="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^([A-Za-z0-9_]+)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="$(toml_value "${BASH_REMATCH[2]}")"
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
    POSTGRES_BACKUP_PASSWORD) gen_pw ;;
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
    # WHY env_quote: writing the raw value makes the shell treat everything after a
    # space as a command, and silently drops the variable (see env_quote above).
    printf '%s=%s\n' "$key" "$(env_quote "$val")"
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
    trimmed="$(toml_trim "$stripped")"
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
    trimmed="$(toml_trim "$stripped")"
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
    trimmed="$(toml_trim "$stripped")"
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

# --- Retired split env files ---
# WHY: compose loads only the merged .env (no compose file declares `env_file:`), so a
# value living in .env.core/.env.contest/.env.worker/.env.infra/.env.tailscale/.env.admin
# was honoured by some scripts and ignored by the stack — the drift behind a false
# configuration-mismatch report. Surviving values are folded into .env, then the split
# file is removed. Absent files are a no-op, so fresh installs and re-runs are unaffected.
SPLIT_ENV_FILES=(.env.core .env.contest .env.worker .env.infra .env.tailscale .env.admin)
# The config.toml section each retired file fed, which is why the file existed: a value it
# carried has to keep reaching .env from the source of truth once the file itself is gone.
declare -A SPLIT_ENV_SECTIONS=(
  [.env.core]=core
  [.env.contest]=contest
  [.env.worker]=worker
  [.env.infra]=infra
  [.env.tailscale]=tailscale
  [.env.admin]=admin
)
declare -A SPLIT_VALUES=()
declare -a SPLIT_KEYS=()

# True when <file> holds a non-empty value for <key>. Presence alone is not enough: the
# merged .env carries every config.toml key, most of them empty, and an empty generated
# value must not displace the real value an operator kept in a split file.
env_file_has_value() {
  local key="$1" file="$2" raw
  [[ -f "$file" ]] || return 1
  raw="$(awk -F= -v k="$key" '$1==k { v=$0; sub(/^[^=]*=/, "", v); print v; exit }' "$file" 2>/dev/null | tr -d '\r' || true)"
  [[ -n "$(env_unquote "$raw")" ]]
}

# Read one retired file into SPLIT_KEYS/SPLIT_VALUES: the keys .env carries no value for.
# Values are copied verbatim; env_quote re-protects them for every reader when written.
collect_split_env_keys() {
  local src="$1" line key val
  SPLIT_KEYS=(); SPLIT_VALUES=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    case "$line" in ''|'#'*) continue ;; esac
    line="${line#export }"
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    val="$(env_unquote "${line#*=}")"
    [[ -n "$val" ]] || continue
    [[ -z "${SPLIT_VALUES[$key]:-}" ]] || continue
    env_file_has_value "$key" "$MERGED_ENV" && continue
    SPLIT_KEYS+=("$key")
    SPLIT_VALUES["$key"]="$val"
  done < "$src"
}

# Write the collected values into .env: a key .env already carries is replaced in place,
# a key it lacks is appended. WHY replace rather than append: raw readers (awk/grep/cut)
# take the FIRST match and the shell takes the LAST, so a duplicated key would leave the
# two disagreeing about the same setting.
apply_split_env_values() {
  local tmp line key
  (( ${#SPLIT_VALUES[@]} > 0 )) || return 0
  declare -A pending=()
  for key in "${!SPLIT_VALUES[@]}"; do pending["$key"]="${SPLIT_VALUES[$key]}"; done
  tmp="$(mktemp)" || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    key="${line%%=*}"
    if [[ "$line" == *=* && -n "${pending[$key]:-}" ]]; then
      printf '%s=%s\n' "$key" "$(env_quote "${pending[$key]}")" >> "$tmp"
      pending["$key"]=""
    else
      printf '%s\n' "$line" >> "$tmp"
    fi
  done < "$MERGED_ENV"
  for key in "${SPLIT_KEYS[@]}"; do
    [[ -n "${pending[$key]:-}" ]] || continue
    printf '%s=%s\n' "$key" "$(env_quote "${pending[$key]}")" >> "$tmp"
    pending["$key"]=""
  done
  # cat into the existing file keeps its inode and permissions (secrets: mode 600).
  if ! cat "$tmp" > "$MERGED_ENV"; then
    rm -f "$tmp"
    return 1
  fi
  rm -f "$tmp"
}

# --- Rescued keys get a durable home in config.toml ---
# WHY: the next sync rebuilds .env from config.toml alone, so a value that only ever lived
# in a split file survives the run that migrates it and is gone from the one after — the
# silent loss behind dead Discord alerting, a missing tailnet front and an empty worker
# fleet. Promoting the value into config.toml makes the migration survive that rebuild.
# A key is only ever added to a section parse_toml reads, because a key written anywhere
# else would be dropped by the next sync just the same.
declare -a TOML_INSERT_KEYS=() TOML_FILL_KEYS=()
# key → section, kept so the write log can still name the section after the write is done.
declare -A TOML_INSERT_SECTION=() TOML_FILL_SECTION=()
# key → section, the ledger of inserts a rewrite pass has not written yet.
declare -A TOML_INSERT_PENDING=()

# Escape a value for the TOML basic string it is written as. `\` and `"` are the two escapes
# toml_value decodes, so the value comes back byte-identical on the next sync.
toml_escape() {
  local v="${1-}"
  v="${v//\\/\\\\}"
  printf '%s' "${v//\"/\\\"}"
}

# One `key = "value"` entry — the form the admin panel's own config.toml writer emits.
# WHY no inline comment on it: the panel's reader takes everything after `=` as the value,
# so a comment left on a written entry shows up as part of the value there and makes its
# config.toml-vs-.env comparison report a drift that does not exist.
toml_entry() {
  printf '%s = "%s"' "$1" "$(toml_escape "$2")"
}

# Sort the rescued keys by what config.toml already says about them. WHAT it says is read
# from the file, not from __TOML: that map also holds values derived at runtime
# (DOMAIN_NAME), and no section can be written for a value the file never had.
# A key the file already values keeps that value. A key the file defines empty is filled
# where it is defined, so the section that owns it wins and the key is never duplicated.
# Args: section_name split_file
classify_split_keys() {
  local section="$1" src="$2" key line trimmed sec=""
  declare -A defined_in=() valued_in=()
  TOML_INSERT_KEYS=(); TOML_FILL_KEYS=()
  TOML_INSERT_SECTION=(); TOML_FILL_SECTION=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    trimmed="$(toml_trim "${line%%#*}")"
    if [[ "$trimmed" =~ ^\[([a-zA-Z0-9_]+)\]$ ]]; then
      sec="${BASH_REMATCH[1]}"
    elif [[ "$trimmed" =~ ^([A-Za-z0-9_]+)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      [[ -n "${SPLIT_VALUES[$key]+set}" ]] || continue
      [[ -n "${defined_in[$key]:-}" ]] || defined_in["$key"]="$sec"
      if [[ -z "${valued_in[$key]:-}" && -n "$(toml_value "${BASH_REMATCH[2]}")" ]]; then
        valued_in["$key"]="$sec"
      fi
    fi
  done < "$TOML_FILE"
  for key in "${SPLIT_KEYS[@]}"; do
    if [[ -n "${valued_in[$key]:-}" ]]; then
      log_info "kept ${key} already set in [${valued_in[$key]}] — the value in ${src} was not needed"
    elif [[ -n "${defined_in[$key]:-}" ]]; then
      TOML_FILL_KEYS+=("$key")
      TOML_FILL_SECTION["$key"]="${defined_in[$key]}"
    else
      TOML_INSERT_KEYS+=("$key")
      TOML_INSERT_SECTION["$key"]="$section"
    fi
  done
}

# Write out the keys still waiting for <section> as that section ends, in the order the
# split file listed them, so a re-run reproduces exactly the same lines. Whatever is still
# waiting once the file has been read through had no section to go into.
# Args: output_file section_name
append_new_toml_keys() {
  local out="$1" section="$2" key
  (( ${#TOML_INSERT_PENDING[@]} > 0 )) || return 0
  for key in "${TOML_INSERT_KEYS[@]}"; do
    [[ "${TOML_INSERT_PENDING[$key]:-}" == "$section" ]] || continue
    printf '%s\n' "$(toml_entry "$key" "${SPLIT_VALUES[$key]}")" >> "$out"
    unset "TOML_INSERT_PENDING[$key]"
  done
}

# Rewrite config.toml: fill the entries the classification marked in place, and append each
# section's missing keys to the end of that section. Every other byte is copied through, so
# comments, ordering and blank lines survive. Returns non-zero without touching the file
# when a section a key needs is absent: the generator would not read a section it does not
# know, so inventing one would hide the value rather than keep it.
rewrite_config_toml() {
  local tmp line trimmed key sec=""
  TOML_INSERT_PENDING=()
  for key in "${TOML_INSERT_KEYS[@]}"; do
    TOML_INSERT_PENDING["$key"]="${TOML_INSERT_SECTION[$key]}"
  done
  tmp="$(mktemp)" || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    trimmed="$(toml_trim "${line%%#*}")"
    if [[ "$trimmed" =~ ^\[([a-zA-Z0-9_]+)\]$ ]]; then
      append_new_toml_keys "$tmp" "$sec"
      sec="${BASH_REMATCH[1]}"
    elif [[ "$trimmed" =~ ^([A-Za-z0-9_]+)[[:space:]]*= ]]; then
      key="${BASH_REMATCH[1]}"
      if [[ -n "${TOML_FILL_SECTION[$key]:-}" && "${TOML_FILL_SECTION[$key]}" == "$sec" ]]; then
        printf '%s\n' "$(toml_entry "$key" "${SPLIT_VALUES[$key]}")" >> "$tmp"
        continue
      fi
    fi
    printf '%s\n' "$line" >> "$tmp"
  done < "$TOML_FILE"
  append_new_toml_keys "$tmp" "$sec"
  if (( ${#TOML_INSERT_PENDING[@]} > 0 )); then
    log_warn "no section to write these keys into: ${!TOML_INSERT_PENDING[*]}"
    rm -f "$tmp"
    return 1
  fi
  # cat into the existing file keeps its inode and permissions (secrets: mode 600).
  if ! cat "$tmp" > "$TOML_FILE"; then
    rm -f "$tmp"
    return 1
  fi
  rm -f "$tmp"
}

# Move the collected keys into config.toml, each into the section that owns it. Returns
# non-zero when they could not be stored, so the caller keeps the split file instead of
# deleting the only surviving copy.
# Args: split_file section_name
promote_split_keys_to_toml() {
  local src="$1" section="$2" key
  (( ${#SPLIT_KEYS[@]} > 0 )) || return 0
  classify_split_keys "$section" "$src"
  if (( ${#TOML_INSERT_KEYS[@]} == 0 && ${#TOML_FILL_KEYS[@]} == 0 )); then
    return 0
  fi
  if ! rewrite_config_toml; then
    log_warn "could not store the keys of ${src} in $TOML_FILE — ${src} kept"
    return 1
  fi
  # Reported only now, so no log line claims a write that did not land.
  for key in "${TOML_FILL_KEYS[@]}"; do
    log_info "filled empty ${key} in $TOML_FILE [${TOML_FILL_SECTION[$key]}] from ${src}"
  done
  for key in "${TOML_INSERT_KEYS[@]}"; do
    log_info "added ${key} to $TOML_FILE [${TOML_INSERT_SECTION[$key]}] from ${src}"
  done
}

# Print exactly what a real run would write into .env and config.toml, and change nothing.
# Args: split_file section_name
report_split_env_dry_run() {
  local src="$1" section="$2" key
  classify_split_keys "$section" "$src"
  for key in "${SPLIT_KEYS[@]}"; do
    printf 'Would migrate %s from %s into %s\n' "$key" "$src" "$MERGED_ENV"
  done
  for key in "${TOML_FILL_KEYS[@]}"; do
    printf 'Would fill the empty %s in %s [%s] with the value from %s\n' \
      "$key" "$TOML_FILE" "${TOML_FILL_SECTION[$key]}" "$src"
  done
  for key in "${TOML_INSERT_KEYS[@]}"; do
    printf 'Would add %s to %s [%s] from %s\n' \
      "$key" "$TOML_FILE" "${TOML_INSERT_SECTION[$key]}" "$src"
  done
  printf 'Would delete retired split env file %s\n' "$src"
}

migrate_split_env_files() {
  local src section key
  for src in "${SPLIT_ENV_FILES[@]}"; do
    [[ -f "$src" ]] || continue
    section="${SPLIT_ENV_SECTIONS[$src]}"
    collect_split_env_keys "$src"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      report_split_env_dry_run "$src" "$section"
      continue
    fi
    # Reported only after the write succeeded, so a failed file is never announced as
    # migrated and never removed.
    if ! apply_split_env_values; then
      log_warn "migration of ${src} failed — $MERGED_ENV left untouched, ${src} kept"
      continue
    fi
    for key in "${SPLIT_KEYS[@]}"; do
      log_info "migrated ${key} from ${src} into $MERGED_ENV"
    done
    # The split file is removed only once its values live where the next sync looks for
    # them again — every run rebuilds .env from config.toml.
    if ! promote_split_keys_to_toml "$src" "$section"; then
      continue
    fi
    if rm -f -- "$src"; then
      log_info "deleted retired split env file ${src}"
    else
      log_warn "could not delete ${src} — remove it manually"
    fi
  done
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

  # Runs on the finished .env and before any consumer reads it, so a value that only
  # existed in a split file is in place for this deploy rather than the next one.
  migrate_split_env_files

  if [[ "$DRY_RUN" -eq 0 ]]; then
    local db_user="${__TOML[core.POSTGRES_USER]:-cmsuser}"
    local db_pass="${__TOML[core.POSTGRES_PASSWORD]:-}"
    local db_name="${__TOML[core.POSTGRES_DB]:-cmsdb}"
    local db_port="${__TOML[core.POSTGRES_PORT]:-5432}"
    local auth_secret="${__TOML[admin.AUTH_SECRET]:-}"
    # WHY: single owner role cmsuser owns large objects — admin panel connects as owner (PostgreSQL restricts large-object access to owner).
    {
      echo "# Auto-generated by ./cms config sync from config.toml."
      # WHY env_quote: db_pass comes from config.toml, so interpolating it straight
      # into a double-quoted URL loses a password containing `"`, `$` or a backslash.
      printf 'DATABASE_URL=%s\n' "$(env_quote "postgresql://${db_user}:${db_pass}@localhost:${db_port}/${db_name}")"
      [[ -n "$auth_secret" ]] && printf 'AUTH_SECRET=%s\n' "$(env_quote "$auth_secret")"
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
       # Fail closed: if injection dies after rewriting .env, restore the
       # previous .env so the live config doesn't drift from cms.toml.
       _env_restore=""
       [[ -f .env ]] && { _env_restore="$(mktemp)"; cp -p .env "$_env_restore"; }
       bash scripts/__inject_config.sh || {
         log_error "Config injection failed"
         if [[ -n "$_env_restore" ]]; then mv "$_env_restore" .env; log_warn "Restored previous .env — cms.toml generation aborted, .env unchanged"; fi
         rm -f "$_env_restore"
         exit 1
       }
       rm -f "$_env_restore"
     else
       log_warn "__inject_config.sh not found — skipping cms.toml generation"
     fi
   else
     log_info "Would run: bash scripts/__inject_config.sh"
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
