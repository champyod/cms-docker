#!/bin/bash

###############################################################################
# Report the initial-certificate status recorded by the certbot container.
# Repository: https://github.com/champyod/cms-docker
###############################################################################
#
# WHY this exists: docker-compose.domain.yml's certbot entrypoint writes
# /etc/letsencrypt/certbot-status (a `pending`/`ok`/`error` line) on the shared
# ./config/letsencrypt bind mount. The renewal loop then runs forever, so the
# only evidence of a failed first issuance is a line in logs that later rotate
# away. This script reads that file so the answer is available without log
# archaeology, and so monitoring and preflight share one interpretation.
#
# Exit codes:
#   0  certificate present, or no domain configured (nothing is owed yet)
#   1  issuance is pending and still retrying (warn — transient)
#   2  issuance failed terminally or the attempt budget is exhausted (error)
#   3  the domain stack is not running at all (not an error on a local box)
#   4  status says ok but the lineage directory is absent (real inconsistency)

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
STATUS_FILE="${REPO_ROOT}/config/letsencrypt/certbot-status"
LE_ROOT="${REPO_ROOT}/config/letsencrypt/live"

# Mirrors the lineage choice in docker-compose.domain.yml: the first configured
# domain names the directory certbot writes. Kept in sync deliberately — reading
# a different directory would report "absent" for a certificate that exists.
configured_lineage() {
  local d
  for d in "${DOMAIN_NAME:-}" "${ADMIN_DOMAIN:-}" "${OJ_DOMAIN:-}" "${RANKING_DOMAIN:-}"; do
    if [ -n "$d" ]; then printf '%s' "$d"; return 0; fi
  done
  return 1
}

load_env() {
  local env_file="${REPO_ROOT}/.env"
  [ -f "$env_file" ] || return 0
  set -a
  # shellcheck source=/dev/null
  . "$env_file" 2>/dev/null || true
  set +a
}

load_env

if [ -z "${DOMAIN_NAME:-}${ADMIN_DOMAIN:-}${OJ_DOMAIN:-}${RANKING_DOMAIN:-}" ]; then
  echo "certbot: no domain configured — nothing to issue"
  exit 0
fi

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'grader-certbot'; then
  echo "certbot: grader-certbot is not running — domain stack is down"
  exit 3
fi

lineage="$(configured_lineage)" || lineage=""
if [ -n "$lineage" ] && [ -d "${LE_ROOT}/${lineage}" ]; then
  echo "certbot: certificate present for ${lineage}"
  exit 0
fi

state=""
detail=""
if [ -f "$STATUS_FILE" ]; then
  # Read the first two whitespace-separated fields: "<state> <detail...>".
  read -r state detail < "$STATUS_FILE" || true
  detail="${detail# }"
fi

case "$state" in
  ok)
    # Record and filesystem disagree; exit 4 keeps this distinct from an issuance failure (2).
    echo "certbot: status claims a certificate for ${lineage} but ${LE_ROOT}/${lineage} is absent"
    exit 4
    ;;
  pending)
    echo "certbot: issuance pending for ${lineage}${detail:+ — ${detail}}"
    echo "         retriable failures back off and retry; no action needed unless this persists"
    exit 1
    ;;
  error)
    echo "certbot: issuance failed for ${lineage}${detail:+ — ${detail}}" >&2
    echo "         inspect: docker logs grader-certbot" >&2
    exit 2
    ;;
  *)
    echo "certbot: no certificate for ${lineage} and no status recorded"
    echo "         the certbot container may predate the status file; check: docker logs grader-certbot" >&2
    exit 2
    ;;
esac