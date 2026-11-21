#!/usr/bin/env bash
#
# Gate for the destructive database teardown targets (`make db-clean` and
# `make db-reset`).
#
# WHY this exists: both targets run
#   docker compose down -v --remove-orphans --profile core --profile admin
#                 --profile contest --profile worker --profile monitor
# which deletes EVERY volume in the cms project and sweeps orphan containers:
#   cms-database-data  cms-logs  cms-data  cms-cache  cms-ranking-data
#   cms-submissions-contest  cms-nginx-cache-contest  cms-nginx-logs-contest
#   cms-worker-tmp-<shard>  cms-redis-rate-limit-data
# plus the orphan containers that share the project but are not part of the
# default compose file set (grader-certbot, grader-waf).
#
# That is unrecoverable, so it must never happen as a side effect of an
# unattended run. WHY the gate is strict rather than a bare [y/N] prompt: the
# convention used by `scripts/__secrets-rotate.sh` only prompts when stdin is a
# terminal, so a scripted or CI invocation would sail straight through the
# prompt and destroy the volumes. Here, a non-interactive caller is REFUSED
# unless it passes an explicit authorisation.
#
# Authorise non-interactively with either:
#   CONFIRM_DB_DESTROY=yes make db-clean
#   make db-clean CONFIRM_DB_DESTROY=yes
#
# For a narrower teardown that keeps the database volume, use the per-stack
# targets instead: core-stop, admin-clean, contest-clean, worker-clean,
# infra-clean, domain-clean, waf-clean (see the Makefile).
#
# Usage: __db_destroy_guard.sh <db-clean|db-reset>

set -euo pipefail

ACTION="${1:-db-clean}"
CONFIRM="${CONFIRM_DB_DESTROY:-no}"

readonly VOLUME_LIST="cms-database-data, cms-logs, cms-data, cms-cache, cms-ranking-data (and every other volume in the cms project)"

# Explicit authorisation wins, and is the only path available to a
# non-interactive caller.
if [[ "${CONFIRM}" == "yes" ]]; then
  echo "CONFIRM_DB_DESTROY=yes — proceeding with destructive volume removal."
  exit 0
fi

# Refuse when nobody is there to answer. This is the point of the gate: a
# cron job, CI pipeline, or piped invocation must not be able to reach
# `down -v` by accident.
if [[ ! -t 0 ]]; then
  {
    echo "REFUSED: 'make ${ACTION}' deletes ${VOLUME_LIST}."
    echo "This cannot be undone and there is no terminal to confirm on."
    echo ""
    echo "To authorise it deliberately, re-run with:"
    echo "    CONFIRM_DB_DESTROY=yes make ${ACTION}"
    echo ""
    echo "For a teardown that keeps the database volume, use a per-stack target:"
    echo "    make core-stop | admin-clean | contest-clean | worker-clean | infra-clean"
  } >&2
  exit 1
fi

# Interactive: require the literal word, not just [y/N], because a stray
# newline must not be read as consent.
printf 'Type "yes" to delete ALL CMS volumes (%s) and orphan containers: ' "${VOLUME_LIST}"
read -r answer || answer=""

if [[ "${answer}" == "yes" ]]; then
  echo "Confirmed — proceeding."
  exit 0
fi

echo "Aborted. Nothing was deleted." >&2
echo "To authorise non-interactively: CONFIRM_DB_DESTROY=yes make ${ACTION}" >&2
exit 1
