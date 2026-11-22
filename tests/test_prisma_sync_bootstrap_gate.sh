#!/usr/bin/env bash
# tests/test_prisma_sync_bootstrap_gate.sh — a failed role bootstrap must stop prisma-sync.
#
# WHY this suite exists: `make prisma-sync` is the last step able to prove cms_backup holds no
# membership in cmsuser (WS-76). While the recipe ended the bootstrap with `|| echo WARN`, a
# bootstrap that exited non-zero — a role file that did not apply, the membership that could not be
# read — still let `migrate deploy` and the seed run, and the deploy reported success over a backup
# credential that could still UPDATE every table. A gate downgraded to a warning is not a gate.
#
# WHAT it proves, with no Docker, no database and no network:
#   1. the bootstrap command is taken from `make -n prisma-sync` — what make would actually run, not a
#      copy of the recipe retyped here — and that command appears before `prisma migrate deploy`;
#   2. the command carries no `|| echo` / `|| true` / `|| :` escape that could absorb a non-zero;
#   3. run against a stub `scripts/__apply_sql.sh` that exits 3, it exits non-zero and prints REFUSED;
#   4. run against a stub that exits 0, the same command exits 0 — the control that proves (3) is the
#      recipe's verdict and not a harness that fails everything;
#   5. the shipped `scripts/__apply_sql.sh --bootstrap-roles` refuses when cms-database is absent
#      instead of skipping with exit 0, and no longer promises a retry after the restart.
#
# Usage: bash tests/test_prisma_sync_bootstrap_gate.sh
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

pass=0
fail=0
ok() { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/cms-prisma-gate.XXXXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# ---------------------------------------------------------------------------
printf '== the command make would run for the bootstrap ==\n'
# ---------------------------------------------------------------------------
RECIPE="${WORK}/recipe.txt"
if ( cd "$ROOT" && env -u MAKEFLAGS -u MAKELEVEL make -n prisma-sync ) > "$RECIPE" 2> "${WORK}/recipe.err"; then
  ok "make -n prisma-sync renders the recipe"
else
  no "make -n prisma-sync failed"
  sed 's/^/        /' "${WORK}/recipe.err"
fi

# The rendered line, verbatim: this is the code under test, so a suite that restated the recipe
# would keep passing after the recipe changed.
BOOTSTRAP_LINE="$(awk '/^bash scripts\/__apply_sql\.sh --bootstrap-roles/ { print; exit }' "$RECIPE")"
BOOTSTRAP_COUNT="$(grep -c '^bash scripts/__apply_sql\.sh --bootstrap-roles' "$RECIPE" || true)"

if [[ "$BOOTSTRAP_COUNT" == "1" && -n "$BOOTSTRAP_LINE" ]]; then
  ok "the recipe bootstraps roles exactly once"
else
  no "expected one 'bash scripts/__apply_sql.sh --bootstrap-roles' recipe line, found ${BOOTSTRAP_COUNT}"
fi

if printf '%s' "$BOOTSTRAP_LINE" | grep -Eq '\|\|[[:space:]]*(echo|true|:|exit[[:space:]]+0)\b'; then
  no "the bootstrap is downgraded to a warning: ${BOOTSTRAP_LINE}"
else
  ok "no || echo / || true / || exit 0 escape on the bootstrap"
fi

BOOTSTRAP_AT="$(grep -n '^bash scripts/__apply_sql\.sh --bootstrap-roles' "$RECIPE" | head -n1 | cut -d: -f1)"
MIGRATE_AT="$(grep -n -- 'migrate deploy --schema' "$RECIPE" | head -n1 | cut -d: -f1)"
if [[ -n "$BOOTSTRAP_AT" && -n "$MIGRATE_AT" && "$BOOTSTRAP_AT" -lt "$MIGRATE_AT" ]]; then
  ok "the bootstrap is gated before 'migrate deploy' (line ${BOOTSTRAP_AT} < ${MIGRATE_AT})"
else
  no "the bootstrap is missing or runs after 'migrate deploy' (bootstrap=${BOOTSTRAP_AT:-none} migrate=${MIGRATE_AT:-none})"
fi

# ---------------------------------------------------------------------------
printf '\n== the recipe stops when the bootstrap fails ==\n'
# ---------------------------------------------------------------------------
SANDBOX="${WORK}/sandbox"
mkdir -p "${SANDBOX}/scripts"

write_stub() { # <exit code>
  cat > "${SANDBOX}/scripts/__apply_sql.sh" <<STUB
#!/usr/bin/env bash
printf 'stub invoked: %s\n' "\$*" > "${SANDBOX}/stub.called"
exit $1
STUB
  chmod +x "${SANDBOX}/scripts/__apply_sql.sh"
}

run_line() { # <exit code for the stub> <log file>; sets RC
  write_stub "$1"
  rm -f "${SANDBOX}/stub.called"
  ( cd "$SANDBOX" && bash -c "$BOOTSTRAP_LINE" ) > "$2" 2>&1
  RC=$?
}

run_line 3 "${WORK}/fail.log"
if [[ ${RC:-0} -ne 0 ]]; then
  ok "a bootstrap exiting 3 fails the recipe (exit ${RC})"
else
  no "a bootstrap exiting 3 was absorbed: the recipe exited 0"
  sed 's/^/        /' "${WORK}/fail.log"
fi

if [[ -f "${SANDBOX}/stub.called" ]]; then
  ok "the failing run actually invoked scripts/__apply_sql.sh"
else
  no "the failing run never invoked scripts/__apply_sql.sh — the command under test is not the bootstrap"
fi

if grep -q 'REFUSED' "${WORK}/fail.log" 2>/dev/null; then
  ok "the refusal is named on stderr"
else
  no "the failure carries no REFUSED message"
  sed 's/^/        /' "${WORK}/fail.log"
fi

# The control: the same command, same extraction, a bootstrap that succeeds. Without this the
# failure case above could pass because the harness is broken rather than because the recipe stops.
run_line 0 "${WORK}/pass.log"
if [[ ${RC:-1} -eq 0 ]]; then
  ok "a bootstrap exiting 0 lets the recipe continue (control)"
else
  no "a successful bootstrap failed the recipe (exit ${RC}) — the control does not hold"
  sed 's/^/        /' "${WORK}/pass.log"
fi

# ---------------------------------------------------------------------------
printf '\n== the bootstrap script refuses instead of skipping when the DB is absent ==\n'
# ---------------------------------------------------------------------------
STAGE="${WORK}/repo"
mkdir -p "${STAGE}/scripts/__lib" "${WORK}/bin"
cp "${ROOT}/scripts/__apply_sql.sh" "${STAGE}/scripts/"
cp "${ROOT}/scripts/__lib/common.sh" "${STAGE}/scripts/__lib/"
printf '%s\n' 'POSTGRES_USER=cmsuser' 'POSTGRES_PASSWORD=stub' 'POSTGRES_DB=cmsdb' \
  'POSTGRES_BACKUP_PASSWORD=stub' > "${STAGE}/.env"

# A daemon that lists no containers: the pruning the suite asks about is the script's own, not
# docker's. Any exec reaching this stub would mean the DB-ready path was taken.
cat > "${WORK}/bin/docker" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "${WORK}/bin/docker"

( cd "$STAGE" && PATH="${WORK}/bin:${PATH}" bash scripts/__apply_sql.sh --bootstrap-roles ) \
  > "${WORK}/apply.log" 2>&1
APPLY_RC=$?

if [[ "$APPLY_RC" -ne 0 ]]; then
  ok "a skipped bootstrap is a failure, not a success (exit ${APPLY_RC})"
else
  no "the bootstrap exited 0 with no database — roles are unproven but the run looks green"
  sed 's/^/        /' "${WORK}/apply.log"
fi

if grep -q 'not running' "${WORK}/apply.log" 2>/dev/null; then
  ok "the refusal says the database is not running"
else
  no "the refusal does not name the missing database"
  sed 's/^/        /' "${WORK}/apply.log"
fi

if grep -q 'retry after the restart' "${WORK}/apply.log" 2>/dev/null; then
  no "the old 'retry after the restart' promise is still made"
else
  ok "no 'retry after the restart' promise"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
