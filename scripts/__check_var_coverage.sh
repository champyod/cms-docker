#!/usr/bin/env bash
# scripts/__check_var_coverage.sh — every compose variable must be configurable.
#
# WHY this gate beside __check_spec_parity.sh: that one proves config.toml.example and
# VAR_SPECS agree, but not that the compose files only consume variables the config can
# actually set. A ${VAR} with no config key silently falls back to its compose default
# and the feature it switches cannot be reached from config.toml at all.
#
# A variable is covered when it appears as a key in config.toml.example (and therefore in
# VAR_SPECS, which the parity gate enforces). Vars that are genuinely internal or derived
# on the host are listed in ALLOW below with the reason.
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

EXAMPLE="${REPO_ROOT}/config.toml.example"
[ -f "$EXAMPLE" ] || log_die "missing $EXAMPLE" 1

# Variables that are intentionally NOT config-driven. Keep this list short and justified.
ALLOW=(
  # Set by docker compose itself / the shell inside a command block, never a knob.
  SCRIPT_DIR
  COMPOSE_PROJECT_NAME
)

compose_vars="$(cd "$REPO_ROOT" && grep -rhoP '(?<!\$)\$\{\K[A-Z_][A-Z0-9_]*' docker-compose*.yml | LC_ALL=C sort -u)"
config_keys="$(grep -oE '^[A-Z_][A-Z0-9_]*' "$EXAMPLE" | LC_ALL=C sort -u)"

rc=0
while IFS= read -r var; do
  [ -n "$var" ] || continue
  if grep -qx "$var" <<<"$config_keys"; then continue; fi
  allowed=0
  for a in "${ALLOW[@]}"; do [ "$var" = "$a" ] && allowed=1; done
  (( allowed == 1 )) && continue
  log_warn "compose uses \${${var}} but config.toml.example has no ${var}"
  rc=1
done <<<"$compose_vars"

if [ "$rc" -eq 0 ]; then
  log_info "variable coverage OK: every compose variable is settable from config.toml.example"
fi
exit "$rc"
