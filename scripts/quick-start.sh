#!/bin/bash
set -euo pipefail

# quick-start.sh — thin delegator to the canonical Makefile workflow.
# Uses docker compose plugin only; legacy compose binary and stale cms.conf not used.

if [[ -f "scripts/lib/common.sh" ]]; then
  # shellcheck source=/dev/null
  source "scripts/lib/common.sh"
elif [[ -f "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh" ]]; then
  # shellcheck source=/dev/null
  source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
fi
if ! declare -F log_info >/dev/null 2>&1; then log_info(){ printf '[INFO] %s\n' "$*"; }; fi
if ! declare -F log_die >/dev/null 2>&1; then log_die(){ printf '[FAIL] %s\n' "${1:-fatal}" >&2; exit "${2:-1}"; }; fi

log_info "CMS quick-start delegator"

if ! command -v docker >/dev/null 2>&1; then
  log_die "docker not found — install Docker: https://docs.docker.com/get-docker/" 1
fi
if ! docker compose version >/dev/null 2>&1; then
  log_die "docker compose plugin not found — install compose v2" 1
fi
log_info "Prerequisites OK: $(docker --version 2>/dev/null | head -n1)"

if [[ ! -f ".env.core" ]]; then
  log_info ".env.core absent — running configure-env.sh"
  if [[ -x "scripts/configure-env.sh" ]]; then
    ./scripts/configure-env.sh
  elif [[ -f "scripts/configure-env.sh" ]]; then
    bash scripts/configure-env.sh
  else
    log_die "scripts/configure-env.sh not found" 1
  fi
else
  log_info ".env.core present"
fi

cat <<'EOF'

Canonical next commands (from Makefile):

  make env            # generate .env + admin-panel/.env + config/cms.toml (runs inject_config.sh)
  make core-img       # deploy core stack (pre-built images; use 'make core' for source build)
  make cms-init       # initialize DB — hard-fails on error (runs scripts/cms-db-init.sh)
  make prisma-sync    # sync Admin Panel schema
  make admin-create   # create superadmin (interactive)
  make admin-img      # deploy admin panel image
  make contest-img    # deploy contest stack
  make worker-img     # deploy workers
  make infra-img      # deploy monitoring

Full workflow: ./scripts/setup.sh  (or make help for all targets)
Docs: docs/TUTORIAL.md

EOF
