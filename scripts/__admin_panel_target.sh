#!/bin/sh
# scripts/__admin_panel_target.sh — the one naming rule for the admin panel's colours.
#
# Sourced, never executed: the route table (bash) and the contest-proxy renderer (sh) both
# dial the panel, and the swap script starts and stops it. Four files hand-named
# cms-admin-panel-next before this; a colour change then meant four edits, and one missed
# edit is a 502 that only shows under traffic.
#
# The rule is one string: the container is cms-admin-panel-<colour>, colour a|b. Colour a
# keeps its historical container name in compose and answers to cms-admin-panel-a as a
# network alias, so every existing consumer of the old name keeps working.

ADMIN_PANEL_COLOUR_DEFAULT=a
ADMIN_PANEL_CONTAINER_PREFIX=cms-admin-panel-
# Written by scripts/__admin_panel_swap.sh, relative to the repository root.
ADMIN_PANEL_STATE_FILE=config/admin-panel-colour

admin_panel_colour_valid() {
  case "${1:-}" in
    a | b) return 0 ;;
    *) return 1 ;;
  esac
}

admin_panel_container() {
  printf '%s%s' "$ADMIN_PANEL_CONTAINER_PREFIX" "$1"
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
