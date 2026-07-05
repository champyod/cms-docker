#!/usr/bin/env bash
# verify.sh — Verify that cms-overlay is correctly applied to the CMS source tree.
#
# Usage:  ./verify.sh
#
# Exit codes:
#   0  — All overlay files present and identical to originals
#   1  — One or more files missing or differ
#   2  — src/ directory missing (submodule not initialised)

set -euo pipefail

OVERLAY_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$OVERLAY_DIR/.." && pwd)"
SRC_DIR="$REPO_ROOT/src"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "FAIL: $SRC_DIR does not exist. Has the submodule been initialised?" >&2
  exit 2
fi

errors=0
while IFS= read -r -d '' overlay_file; do
  relative="${overlay_file#$OVERLAY_DIR/src/}"
  target="$SRC_DIR/$relative"

  # skip docker/ files — they aren't applied to src/
  if [[ "$relative" == docker/* ]]; then
    continue
  fi

  if [[ ! -f "$target" ]]; then
    echo "MISSING: $relative"
    errors=$(( errors + 1 ))
    continue
  fi

  if ! diff -q "$overlay_file" "$target" >/dev/null 2>&1; then
    echo "DIFFERS: $relative"
    errors=$(( errors + 1 ))
  fi
done < <(find "$OVERLAY_DIR/src" -type f -print0)

if [[ $errors -eq 0 ]]; then
  echo "PASS: All overlay files are correctly applied."
  exit 0
else
  echo ""
  echo "FAIL: $errors file(s) missing or differ. Run ./apply.sh to re-apply."
  exit 1
fi
