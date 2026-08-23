#!/usr/bin/env bash
# [deprecated] superseded by the one-stop orchestrator at repo root.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "[deprecated] quick-start.sh is now ./cms.sh — handing off..." >&2
exec ./cms.sh "$@"
