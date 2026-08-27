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
# Usage: bash scripts/__tui/wizards/__setup-update.sh [engine args...]

TUI_STANDALONE=0
[[ "${BASH_SOURCE[0]}" == "$0" ]] && { TUI_STANDALONE=1; set -euo pipefail; }

ENGINE="scripts/__update_engine.sh"

log_info() { printf '[INFO] %s\n' "$*"; }
die() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

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
    if is_fresh; then
      tui::confirm "Start the first-time setup wizard now?" || die "aborted — run it later with: bash $ENGINE --fresh"
    else
      tui::confirm "Open the configuration update wizard now?" || die "aborted — run it later with: bash $ENGINE"
    fi
  else
    # Non-interactive: never launch a prompt-driven engine blind.
    log_info "Non-interactive terminal — run manually:"
    log_info "  bash $ENGINE ${MODE_ARGS[*]:-}"
    exit 1
  fi
  exec bash "$ENGINE" ${MODE_ARGS[@]+"${MODE_ARGS[@]}"}
}

if [[ "$TUI_STANDALONE" == 1 ]]; then main "$@"; fi
