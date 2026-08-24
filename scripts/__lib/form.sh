#!/bin/bash
# Inline full-screen form editor (pure bash, cfdisk-style).
#
#   source scripts/__lib/form.sh
#   if ui_form_edit "Title" "key1|Label 1|default1" "key2|Label 2|1.2.3.4"; then
#       echo "saved: $FORM_OUT_key1 / $FORM_OUT_key2"
#   else echo cancelled; fi
#
#   • Defaults are pre-filled EDITABLE text — no Enter-to-keep prompts.
#   • ←→ move inside a value · typing inserts at cursor · Backspace/Delete edit
#   • ↑ ↓ Tab move between fields · Enter = next field (save on last)
#   • Esc anywhere cancels (function returns 1); on save sets FORM_OUT_<key>.

ui_form_edit() {
  local title="$1"; shift
  local -a KEYS=() LABELS=() VALS=() POS=()
  local spec k l d i w v p out width nf
  for spec in "$@"; do
    IFS='|' read -r k l d <<<"$spec"
    KEYS+=("$k"); LABELS+=("$l"); VALS+=("$d"); POS+=("${#d}")
  done
  nf=${#KEYS[@]}
  local fi=0
  local FORM_TITLE_C=$'\033[1;36m' FORM_HI=$'\033[7m' FORM_DIM=$'\033[2m' FORM_R=$'\033[0m'

  w=0
  for ((i=0;i<nf;i++)); do [ "${#LABELS[$i]}" -gt "$w" ] && w=${#LABELS[$i]}; done

  _draw() {
    clear 2>/dev/null || true
    width=$(( w + 48 ))
    printf '%s┌─ %s %s┐%s\n' "$FORM_TITLE_C" "$title" \
      "$(printf '─%.0s' $(seq $(( width - ${#title} - 4 ))))" "$FORM_R"
    for ((i=0;i<nf;i++)); do
      v="${VALS[$i]}"; p="${POS[$i]}"
      if [ "$i" = "$fi" ]; then
        out="${v:0:p}${FORM_HI}▊${FORM_R}${v:$((p))}"
        printf '%s│%s %-*s : %s%s │\n' "$FORM_TITLE_C" "$FORM_R" "$w" "${LABELS[$i]}" "$out" "$FORM_R"
      else
        printf '%s│%s %-*s : %-42s%s │\n' "$FORM_TITLE_C" "$FORM_R" "$w" "${LABELS[$i]}" "$v" "$FORM_R"
      fi
    done
    printf '%s└%s┘%s\n' "$FORM_TITLE_C" "$(printf '─%.0s' $(seq "$width"))" "$FORM_R"
    printf ' %s↑↓/Tab field · ←→ cursor · type to edit · Enter next/save · Esc cancel%s\n' "$FORM_DIM" "$FORM_R"
  }

  local key esc
  while true; do
    _draw
    if ! IFS= read -rsn1 key; then return 1; fi
    case "$key" in
      $'\x1b')
        esc=""
        IFS= read -rsn2 -t 0.05 esc || return 1          # bare Esc → cancel
        case "$esc" in
          '[C') [ "${POS[$fi]}" -lt "${#VALS[$fi]}" ] && POS[$fi]=$((POS[$fi]+1)) ;;
          '[D') [ "${POS[$fi]}" -gt 0 ] && POS[$fi]=$((POS[$fi]-1)) ;;
          '[A'|'[Z') fi=$(( (fi + nf - 1) % nf )) ;;
          '[B') fi=$(( (fi + 1) % nf )) ;;
          '[3')                                            # Delete: drop char right of cursor
            IFS= read -rsn1 -t 0.05 esc || true
            VALS[$fi]="${VALS[$fi]:0:${POS[$fi]}}${VALS[$fi]:$((POS[$fi]+1))}" ;;
        esac ;;
      $'\r'|$'\n')
        if [ "$fi" -eq $((nf-1)) ]; then
          for ((i=0;i<nf;i++)); do
            printf -v "FORM_OUT_${KEYS[$i]}" '%s' "${VALS[$i]}"
            export "FORM_OUT_${KEYS[$i]}"
          done
          return 0
        fi
        fi=$((fi+1)) ;;
      $'\t'|$'\Z') fi=$(( (fi + 1) % nf )) ;;
      $'\x7f')
        if [ "${POS[$fi]}" -gt 0 ]; then
          VALS[$fi]="${VALS[$fi]:0:$((POS[$fi]-1))}${VALS[$fi]:${POS[$fi]}}"
          POS[$fi]=$((POS[$fi]-1))
        fi ;;
      [[:print:]])
        VALS[$fi]="${VALS[$fi]:0:${POS[$fi]}}${key}${VALS[$fi]:${POS[$fi]}}"
        POS[$fi]=$((POS[$fi]+1)) ;;
    esac
  done
}
