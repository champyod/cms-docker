#!/usr/bin/env bash
# Setup/update wizard handoff — thin gum frame around scripts/__update_engine.sh.
#
# The update engine owns its own interactive prompts; this wrapper does NOT
# reimplement them. It detects the mode exactly like ./cms setup does
# (.env.core existence), explains the handoff in a gum frame, confirms, then
# execs the engine so it owns the terminal.
#
# Mode resolution:
#   explicit --fresh|--fix|--dry-run|--update-server arg  -> forwarded as-is
#   no .env.core                                          -> --fresh
#   otherwise                                             -> plain update walk
#
# Usage: bash scripts/__tui/wizards/setup-update.sh [engine args...]

TUI_STANDALONE=0
[[ "${BASH_SOURCE[0]}" == "$0" ]] && { TUI_STANDALONE=1; set -euo pipefail; }

ENGINE="scripts/__update_engine.sh"
TUI_ENGINE="scripts/__tui/__engine.sh"
if [[ -f "$TUI_ENGINE" ]]; then
    # shellcheck source=/dev/null
    source "$TUI_ENGINE"
elif [[ -f "$(dirname "${BASH_SOURCE[0]}")/../__engine.sh" ]]; then
    # shellcheck source=/dev/null
    source "$(dirname "${BASH_SOURCE[0]}")/../__engine.sh"
fi

log_info() { printf '[INFO] %s\n' "$*"; }
die() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

get_var() {
    local file=$1 key=$2
    awk -F= -v k="$key" '$1==k { v=$0; sub(/^[^=]*=/, "", v); sub(/[[:space:]]*#.*$/, "", v); print v; exit }' "$file" 2>/dev/null | tr -d '\r' || true
}
get_default_for() {
    local file=$1 key=$2
    local ex="${file}.example"
    [ -f "$ex" ] || return 0
    awk -F= -v k="$key" '$1==k { v=$0; sub(/^[^=]*=/, "", v); sub(/[[:space:]]*#.*$/, "", v); gsub(/^[ \t]+|[ \t]+$/, "", v); print v; exit }' "$ex" 2>/dev/null | tr -d '\r' || true
}
is_default_secret() {
    local v="${1:-}"; [ -z "$v" ] && return 0
    case "$v" in cmspassword|usern4me|passw0rd|DEFAULT_SECRET_KEY|YOUR_DB_PASSWORD_HERE|YOUR_RANKING_PASSWORD_HERE|CHANGE_ME*) return 0 ;; esac
    [[ "$v" == YOUR_* || "$v" == *PASSWORD_HERE* ]]
}
is_secret_key() { [[ "$1" =~ (PASSWORD|SECRET|TOKEN|KEY) ]]; }
mask_show() {
    if is_secret_key "$1"; then
        local v="${2:-}"; if [ -z "$v" ]; then echo "<empty>"; elif is_default_secret "$v"; then echo "<default-insecure>"; else echo "<hidden>"; fi
    else echo "${2:-<empty>}"; fi
}
get_status() {
    local file=$1 key=$2 current=$3 default_val=$4
    if [ -z "$current" ]; then echo "MISSING"; return; fi
    if is_default_secret "$current"; then echo "DEFAULT"; return; fi
    if [ -n "$default_val" ] && [ "$current" = "$default_val" ]; then echo "DEFAULT"; return; fi
    echo "CUSTOM"
}

render_vars_list() {
    local use_tui=0
    tui::tty_ok 2>/dev/null && use_tui=1 || true
    local header="Var\tCurrent\tDefault\tStatus\tFile"
    local rows=""
    local var file cur def st cur_d def_d
    while IFS= read -r var; do
        [ -z "$var" ] && continue
        file=""
        for f in .env.core .env.admin .env.contest .env.worker .env.infra; do
            if grep -q "^${var}=" "${f}.example" 2>/dev/null; then file="$f"; break; fi
        done
        [ -z "$file" ] && file=".env.core"
        cur=$(get_var "$file" "$var")
        def=$(get_default_for "$file" "$var")
        st=$(get_status "$file" "$var" "$cur" "$def")
        cur_d=$(mask_show "$var" "$cur")
        def_d=$(mask_show "$var" "$def")
        rows+="${var}\t${cur_d}\t${def_d}\t${st}\t${file}"$'\n'
    done < <(grep -h "^[A-Z_]*=" .env.*.example 2>/dev/null | cut -d= -f1 | sort -u)
    if [ "$use_tui" = "1" ]; then
        { echo -e "$header"; echo -e "$rows"; } | tui::table
    else
        printf "%-28s %-22s %-22s %-10s %s\n" "Var" "Current" "Default" "Status" "File"
        printf "%-28s %-22s %-22s %-10s %s\n" "----------------------------" "----------------------" "----------------------" "----------" "--------------"
        while IFS=$'\t' read -r var cur def st file; do
            [ -z "$var" ] && continue
            printf "%-28s %-22s %-22s %-10s %s\n" "$var" "$cur" "$def" "$st" "$file"
        done <<<"$(echo -e "$rows")"
    fi
}

handle_vars_navigation() {
    local use_tui=0
    tui::tty_ok 2>/dev/null && use_tui=1 || true
    if [ "$use_tui" != "1" ]; then
        render_vars_list
        echo ""
        tui::panel "Plain mode" "Var table above shows Current vs Default." "You will be asked per-var: [e]dit / [k]eep / [c]onfirm." "Use --yes to skip prompts, --fix to fill missing only." 2>/dev/null || true
        return 0
    fi
    while true; do
        render_vars_list
        echo ""
        local action
        action=$(tui::choose "Vars overview — choose action" "e) edit a variable" "c) confirm keep all" "a) apply all confirmed" "q) quit to editor" "Enter) continue to per-var wizard") || break
        case "$action" in
            e* ) 
                local var
                var=$(grep -h "^[A-Z_]*=" .env.*.example 2>/dev/null | cut -d= -f1 | sort -u | tui::filter "Type var name to edit") || continue
                [ -z "$var" ] && continue
                local file=""
                for f in .env.core .env.admin .env.contest .env.worker .env.infra; do
                    if grep -q "^${var}=" "${f}.example" 2>/dev/null; then file="$f"; break; fi
                done
                [ -z "$file" ] && file=".env.core"
                local cur=$(get_var "$file" "$var")
                local def=$(get_default_for "$file" "$var")
                local st=$(get_status "$file" "$var" "$cur" "$def")
                tui::panel "$var" "Current: $(mask_show "$var" "$cur")" "Default: $(mask_show "$var" "$def")" "Status: $st" "File: $file"
                local sub
                sub=$(tui::choose "Action for $var" "edit value" "confirm keep" "update to default" "back") || continue
                case "$sub" in
                    *edit* )
                        read -r -p "  new value for $var: " newval || continue
                        if [ -f "$file" ]; then
                            if grep -q "^${var}=" "$file"; then
                                local esc=$(echo "$newval" | sed 's/[&/]/\\&/g')
                                sed -i "s|^${var}=.*|${var}=${esc}|" "$file"
                            else echo "${var}=${newval}" >> "$file"; fi
                        else echo "${var}=${newval}" > "$file"; fi
                        tui::audit "vars.edit" "$var" 2>/dev/null || true
                        ;;
                    *keep* ) : ;;
                    *default* )
                        if [ -n "$def" ]; then
                            if grep -q "^${var}=" "$file" 2>/dev/null; then
                                local esc=$(echo "$def" | sed 's/[&/]/\\&/g')
                                sed -i "s|^${var}=.*|${var}=${esc}|" "$file"
                            else echo "${var}=${def}" >> "$file"; fi
                        fi
                        ;;
                    *) : ;;
                esac
                ;;
            c* ) break ;;
            a* ) break ;;
            *continue* ) break ;;
            q* ) die "aborted — vars navigation quit" ;;
            *) break ;;
        esac
    done
}

has_mode_flag() {
  local a
  for a in "$@"; do
    case "$a" in
      --fresh|--fix|--dry-run|--update-server) return 0 ;;
    esac
  done
  return 1
}

resolve_mode_args() {  # -> MODE_ARGS array
  MODE_ARGS=("$@")
  if ! has_mode_flag "$@" && [[ ! -f .env.core ]]; then
    MODE_ARGS=(--fresh)
  fi
}

is_fresh() {
  local a
  for a in ${MODE_ARGS[@]+"${MODE_ARGS[@]}"}; do
    [[ "$a" == "--fresh" ]] && return 0
  done
  return 1
}

handoff_frame() {  # explainer shown before the engine takes over
  if tui::tty_ok; then
    if is_fresh; then
      tui::header "CMS First-Time Setup"
      tui::panel "Handing off to the setup engine" \
        "No existing installation detected (.env.core missing)." \
        "The guided wizard will write every managed variable" \
        "and bootstrap all stacks." \
        "You can safely re-run it after partial failures."
    else
      tui::header "CMS Configuration Update"
      tui::panel "Handing off to the update engine" \
        "Existing install detected." \
        "The interactive wizard walks all managed sections and" \
        "only changes values you edit."
      tui::audit "setup.handoff" "update"
    fi
  else
    printf '=== CMS setup/update ===\n'
  fi
}

main() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." || exit 1
  [[ -f "$ENGINE" ]] || die "engine not found: $ENGINE"
  resolve_mode_args "$@"
  if tui::init; then
    handoff_frame
    render_vars_list
    handle_vars_navigation
    if is_fresh; then
      tui::confirm "Start the first-time setup wizard now?" || die "aborted — run it later with: bash $ENGINE --fresh"
    else
      tui::confirm "Open the configuration update wizard now?" || die "aborted — run it later with: bash $ENGINE"
    fi
  else
    render_vars_list
    log_info "Non-interactive terminal — run manually:"
    log_info "  bash $ENGINE ${MODE_ARGS[*]:-}"
    exit 1
  fi
  exec bash "$ENGINE" ${MODE_ARGS[@]+"${MODE_ARGS[@]}"}
}

if [[ "$TUI_STANDALONE" == 1 ]]; then main "$@"; fi
