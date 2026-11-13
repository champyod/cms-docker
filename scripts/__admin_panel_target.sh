#!/bin/sh
# scripts/__admin_panel_target.sh — the one naming rule for the admin panel's colours.
#
# Sourced, never executed: the route table (bash) and the contest-proxy renderer (sh) both
# dial the panel, and the swap script starts and stops it. Four files hand-named
# cms-admin-panel-next before this; a colour change then meant four edits, and one missed
# edit is a 502 that only shows under traffic.
#
# The rule is one table: the container is looked up from the colour, and that container name
# is also the name nginx dials (a container's name is its DNS name on the compose network).
# Colour a keeps its historical name so every existing consumer of it keeps working.

ADMIN_PANEL_COLOUR_DEFAULT=a
# Written by scripts/__admin_panel_swap.sh, relative to the repository root.
ADMIN_PANEL_STATE_FILE=config/admin-panel-colour

admin_panel_colour_valid() {
  case "${1:-}" in
    a | b) return 0 ;;
    *) return 1 ;;
  esac
}

# The container that answers for a colour, and therefore the name nginx dials: a container's
# own name is its DNS name on the compose network. Colour a keeps the name the rest of the
# stack already knows (prometheus target, security overlay, smoke test), which is why this is
# a table and not a prefix.
admin_panel_container() {
  case "${1:-}" in
    a) printf 'cms-admin-panel-next' ;;
    b) printf 'cms-admin-panel-b' ;;
    *) return 1 ;;
  esac
}

# The compose service that owns each colour. It differs from the container name for colour a,
# whose service name predates the colours and is named by the rest of the stack.
admin_panel_service() {
  case "${1:-}" in
    a) printf 'admin-panel-next' ;;
    b) printf 'admin-panel-next-b' ;;
    *) return 1 ;;
  esac
}

# The colour the front should dial: the recorded colour, else the configured value, else a.
#
# WHY the recorded colour outranks the environment: the file says which colour is live now,
# while the environment carries the value .env was rendered with. A re-render after a swap
# must not drag traffic back to a colour the swap already retired.
#
# Prints the colour on success; on an invalid value prints why and returns 1, so the caller
# decides whether that is fatal (both shipped callers make it fatal).
admin_panel_colour_resolve() {
  _ap_root="${1:-}"
  if [ -n "$_ap_root" ] && [ -r "${_ap_root}/${ADMIN_PANEL_STATE_FILE}" ]; then
    _ap_colour="$(tr -d '[:space:]' < "${_ap_root}/${ADMIN_PANEL_STATE_FILE}")"
    if ! admin_panel_colour_valid "$_ap_colour"; then
      echo "${ADMIN_PANEL_STATE_FILE} holds '${_ap_colour}', which is not a colour (a|b)" >&2
      return 1
    fi
    printf '%s' "$_ap_colour"
    return 0
  fi
  _ap_colour="${ADMIN_PANEL_COLOUR:-}"
  [ -n "$_ap_colour" ] || _ap_colour="$ADMIN_PANEL_COLOUR_DEFAULT"
  if ! admin_panel_colour_valid "$_ap_colour"; then
    echo "ADMIN_PANEL_COLOUR='${_ap_colour}' is not a colour (a|b)" >&2
    return 1
  fi
  printf '%s' "$_ap_colour"
}
