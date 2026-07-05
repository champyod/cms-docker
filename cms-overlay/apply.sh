#!/usr/bin/env bash
# apply.sh — Apply cms-overlay files onto the CMS source tree.
#
# Usage:  ./apply.sh [--check]
#
#   --check  Dry-run; print what would be copied without making changes.
#
# Copies every file under src/ in this directory into the corresponding
# path under REPO_ROOT/src/, overwriting any existing file.
#
# Designed to be run after `git submodule update --init src/` (or
# equivalent) to re-apply our customisations atop a fresh checkout.
#
# Non‑goals:
#   - Does NOT touch src/docker/ (those files live at repo root).
#   - Does NOT run `apply_contest.py` — that is handled separately in
#     the Docker entrypoint / Makefile.

set -euo pipefail

OVERLAY_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$OVERLAY_DIR/.." && pwd)"
SRC_DIR="$REPO_ROOT/src"

CHECK=false
if [[ "${1:-}" == "--check" ]]; then
  CHECK=true
fi

if [[ ! -d "$SRC_DIR" ]]; then
  echo "ERROR: $SRC_DIR does not exist. Have you initialised the submodule?" >&2
  echo "  git submodule update --init src/" >&2
  exit 1
fi

if $CHECK; then
  echo "=== Dry-run: files that would be copied ==="
fi

overlaid=0
skipped=0
while IFS= read -r -d '' overlay_file; do
  # Strip the overlay/src/ prefix
  relative="${overlay_file#$OVERLAY_DIR/src/}"
  target="$SRC_DIR/$relative"

  if [[ "$relative" == docker/* ]]; then
    # These are not applied to src/; they live at the repo root.
    continue
  fi

  if $CHECK; then
    echo "  -> $relative"
    overlaid=$(( overlaid + 1 ))
    continue
  fi

  mkdir -p "$(dirname "$target")"
  cp --preserve=timestamp "$overlay_file" "$target"
  echo "  ✓ $relative"
  overlaid=$(( overlaid + 1 ))
done < <(find "$OVERLAY_DIR/src" -type f -print0)

echo ""
echo "Done. $overlaid file(s) applied."
[[ $skipped -gt 0 ]] && echo "(Skipped $skipped file(s) — not under src/.)"
