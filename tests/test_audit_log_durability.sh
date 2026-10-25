#!/usr/bin/env bash
# tests/test_audit_log_durability.sh — the audit log is hard to alter, bounded by a decision, and
# provable after a restore.
#
# WHY this suite exists. D3 asked three questions the schema could not answer:
#   (a) can anything rewrite or delete an audit row, chain or no chain;
#   (b) what happens to the log's size over years, and is retention a decision or an accident;
#   (c) does the backup carry the log, and can an operator prove the chain after a restore.
# Before this change the answers were: (a) `cmsuser` owned the table, so it could disable the very
# policy that filtered writes, and `TRUNCATE` — which row security does not cover — emptied the log
# in one statement; (b) nothing pruned, ever; (c) the log was deliberately excluded from the backup
# catalog and nothing else carried it. Each section below fails on the commit that had those
# answers.
#
# HOW it is two suites in one:
#   · STATIC checks run everywhere (CI has no database) and are what make this fail on the base
#     commit: the migration, the shared hash recipe, the verifier entry point, the make targets, the
#     backup artifact and the removal of the old "append-only by absence" policy.
#   · DATABASE checks run only against a scratch database you name, because the properties are
#     Postgres behaviours, not file contents. They are the part that proves a refusal is a refusal
#     and not a silent zero-row no-op.
#
# RUN the database half:
#   CMS_AUDIT_TEST_DATABASE_URL=postgresql://cmsuser:pw@127.0.0.1:55440/cmsdb \
#   CMS_AUDIT_TEST_SUPERUSER_URL=postgresql://postgres:pw@127.0.0.1:55440/cmsdb \
#     bash tests/test_audit_log_durability.sh
# The scratch database must already carry the migration history (`prisma migrate deploy`); the
# superuser URL is used only to emulate an attacker who can disable the guard trigger, which is
# exactly what the ownership separation exists to prevent.
set -u

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$REPO_ROOT/admin-panel/prisma/migrations/20261026120100_audit_log_durable/migration.sql"
RETENTION_TABLE_MIGRATION="$REPO_ROOT/admin-panel/prisma/migrations/20261026115900_audit_log_retention_table/migration.sql"
CHAIN_MODULE="$REPO_ROOT/admin-panel/src/lib/audit-chain.ts"
AUDIT_MODULE="$REPO_ROOT/admin-panel/src/lib/audit.ts"
CLI="$REPO_ROOT/admin-panel/scripts/audit-log.ts"
PSQL="${PSQL:-psql}"

pass=0
fail=0
ok() { printf '  [ok]   %s\n' "$1"; pass=$((pass + 1)); }
bad() {
  printf '  [FAIL] %s\n' "$1"
  fail=$((fail + 1))
}
check() { # <description> <expected> <actual>
  if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected '$2', got '$3')"; fi
}
present() { # <description> <file> <pattern>
  if grep -qE -- "$3" "$2" 2>/dev/null; then ok "$1"; else bad "$1 — no match for /$3/ in $(basename -- "$2")"; fi
}
absent() { # <description> <file> <pattern>
  if grep -qE -- "$3" "$2" 2>/dev/null; then bad "$1 — found /$3/ in $(basename -- "$2")"; else ok "$1"; fi
}

# ---------------------------------------------------------------------------
# 1. The migration exists and says what it must
# ---------------------------------------------------------------------------
printf '== the append-only guard is a committed migration ==\n'
check "the durable migration exists" "yes" "$([ -f "$MIGRATION" ] && echo yes || echo no)"
if [ -f "$MIGRATION" ]; then
  present "row-level guard refuses UPDATE" "$MIGRATION" 'audit_log is append-only: UPDATE of row'
  present "row-level guard refuses DELETE" "$MIGRATION" 'audit_log is append-only: DELETE of row'
  present "statement guard refuses DELETE even when nothing matches" "$MIGRATION" 'cms_audit_log_statement_guard'
  present "TRUNCATE is refused (row security never covered it)" "$MIGRATION" 'BEFORE TRUNCATE ON public.audit_log'
  present "DELETE outside the retention identity is refused by name" "$MIGRATION" 'system:audit-retention'
  present "UPDATE/DELETE/TRUNCATE are revoked from the application role" "$MIGRATION" 'REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.audit_log FROM cmsuser'
  present "the window is a single measured number" "$MIGRATION" 'SELECT 400'
  present "the prune is the only deleting path" "$MIGRATION" 'cms_audit_prune'
  present "an owner role separates the guard from the app role" "$MIGRATION" 'cms_audit_owner'
  # The old design's whole claim was "append-only by ABSENCE of UPDATE/DELETE". Absence filters
  # rows, it does not refuse a statement, so it must not come back as the audit_log rule.
  absent "audit_log gains no UPDATE policy" "$MIGRATION" 'ON public\.audit_log FOR UPDATE'
fi
check "the prune ledger table migration exists" "yes" "$([ -f "$RETENTION_TABLE_MIGRATION" ] && echo yes || echo no)"
present "the ledger is a real table, not a column" "$RETENTION_TABLE_MIGRATION" 'CREATE TABLE IF NOT EXISTS "audit_log_retention"'
present "the ledger is chainable (prev_hash/entry_hash)" "$RETENTION_TABLE_MIGRATION" '"prev_hash" VARCHAR'

# ---------------------------------------------------------------------------
# 2. One hash recipe, shared by the writer and the verifier
# ---------------------------------------------------------------------------
printf '== the chain verifier recomputes what the writer wrote ==\n'
check "the shared chain module exists" "yes" "$([ -f "$CHAIN_MODULE" ] && echo yes || echo no)"
if [ -f "$CHAIN_MODULE" ]; then
  present "it owns the digest" "$CHAIN_MODULE" 'export function computeEntryHash'
  present "it owns the row canonical form" "$CHAIN_MODULE" 'export function canonicaliseAuditRow'
  present "it verifies links, hashes and gaps" "$CHAIN_MODULE" 'export function verifyAuditChain'
  present "legacy rows are recognised, not failed" "$CHAIN_MODULE" 'legacy-entry'
  absent "it does not re-implement JSON ordering per call site" "$CHAIN_MODULE" 'function canonicaliseEntry'
fi
present "the writer imports the shared canonical form" "$AUDIT_MODULE" "canonicaliseAuditRow"
absent "the writer no longer hashes the caller's entry object" "$AUDIT_MODULE" 'canonicaliseEntry\(entry\)'
# The defect this closes: a hash over the caller's object could not be re-derived from the row.
present "the writer hashes the row it writes" "$AUDIT_MODULE" 'const payload: AuditRowPayload'

# ---------------------------------------------------------------------------
# 3. The operator entry points exist and are wired where operations live
# ---------------------------------------------------------------------------
printf '== the verifier is an operator command, not a library ==\n'
check "the audit-log CLI exists" "yes" "$([ -f "$CLI" ] && echo yes || echo no)"
if [ -f "$CLI" ]; then
  present "verify is a command" "$CLI" "case 'verify'"
  present "status is a command" "$CLI" "case 'status'"
  present "prune is a command" "$CLI" "case 'prune'"
  present "a broken chain exits 1" "$CLI" 'EXIT_BROKEN = 1'
  present "an unverifiable log exits 2, never 0" "$CLI" 'EXIT_CANNOT_EVALUATE = 2'
fi
present "make audit-verify exists" "$REPO_ROOT/Makefile" '^audit-verify:'
present "make audit-status exists" "$REPO_ROOT/Makefile" '^audit-status:'
present "make audit-retention exists" "$REPO_ROOT/Makefile" '^audit-retention:'
present "make audit-restore-verify exists" "$REPO_ROOT/Makefile" '^audit-restore-verify:'
present "make audit-owner-bootstrap exists" "$REPO_ROOT/Makefile" '^audit-owner-bootstrap:'

# ---------------------------------------------------------------------------
# 4. Retention is decided, and only the maintenance path may delete
# ---------------------------------------------------------------------------
printf '== retention is a decision with one deleter ==\n'
present "the retention service is a compose service" "$REPO_ROOT/docker-compose.yml" '^  audit-retention:'
present "it runs on its own profile, deliberately" "$REPO_ROOT/docker-compose.yml" '^      - audit$'
present "the service runs the same script an operator runs" "$REPO_ROOT/docker-compose.yml" 'scripts/audit-log\.ts prune --apply'
present "the bootstrap script exists" "$REPO_ROOT/scripts/__audit_owner_bootstrap.sh" 'cms_audit_owner'
present "the restore proof script exists" "$REPO_ROOT/scripts/__audit_restore_proof.sh" 'pg_restore'

# ---------------------------------------------------------------------------
# 5. The backup carries the log, and offsite carries the backup
# ---------------------------------------------------------------------------
printf '== the backup carries the audit log ==\n'
present "the backup dumps the log as its own artifact" "$REPO_ROOT/scripts/__backup.sh" 'audit-log-\$\{ts\}\.dump'
present "the dump carries the prune ledger too, not just the log" "$REPO_ROOT/scripts/__backup.sh" '-t audit_log_retention'
present "rotation removes the artifact with its set" "$REPO_ROOT/scripts/__backup.sh" 'audit-log-\$\{ts\}\.dump\.sha256'
present "offsite ships the newest audit archive" "$REPO_ROOT/scripts/__offsite-sync.sh" 'audit-log-"\*\.dump'

# ---------------------------------------------------------------------------
# 6. Database behaviour — the part that proves a refusal is not a no-op
# ---------------------------------------------------------------------------
DB_URL="${CMS_AUDIT_TEST_DATABASE_URL:-}"
SU_URL="${CMS_AUDIT_TEST_SUPERUSER_URL:-}"
if [ -z "$DB_URL" ]; then
  printf '\nSKIP: set CMS_AUDIT_TEST_DATABASE_URL (and CMS_AUDIT_TEST_SUPERUSER_URL) to a scratch\n'
  printf '      database carrying the migration history to run the behavioural checks.\n'
elif ! command -v bun >/dev/null 2>&1; then
  printf '\nSKIP: bun is not on PATH, so the panel CLI cannot run here.\n'
else
  printf '\n== database: the application role cannot rewrite or delete history ==\n'
  PSQL_BIN="${PSQL%% *}"
  app() { $PSQL_BIN "$DB_URL" -X -q -tA -v ON_ERROR_STOP=0 -c "$1" 2>&1; }
  # WHY SET and not SET LOCAL: a bare -c is its own implicit transaction only when it contains
  # several statements; SET LOCAL outside one warns and does nothing, which would have made every
  # refusal below look like an actor-less query.
  app_actor() { $PSQL_BIN "$DB_URL" -X -q -tA -v ON_ERROR_STOP=0 -c "SET cms.actor = 'system:cli'; $1" 2>&1; }
  su() { $PSQL_BIN "$SU_URL" -X -q -tA -v ON_ERROR_STOP=0 -c "$1" 2>&1; }
  cli() { ( cd "$REPO_ROOT/admin-panel" && DATABASE_URL="$DB_URL" AUTH_SECRET=test bun run scripts/audit-log.ts "$@" 2>&1 ); }

  # A valid chain seeded with coreutils: the payload is the exact canonical row the shared module
  # produces, hashed with sha256sum. If the TypeScript recipe ever drifts from this string, the
  # verifier stops accepting these rows — which is the byte-identity the shared function promises.
  #
  # ORDER MATTERS: the two ancient rows go in first so they are the OLDEST ids. Retention removes
  # ids from the front, so the fixture has to look like a real log (ids increase with time) for
  # "the prune cut a prefix and anchored the boundary" to mean anything.
  seed=0
  prev=""
  seed_row() { # <verb> <age-interval or empty>
    local verb="$1" age="${2:-}"
    local payload hash out prev_sql
    payload=$(printf '{"actor_id":null,"after_values":null,"before_values":null,"entity":"contest","entity_id":null,"ip":null,"reason":null,"result":"success","session_id":null,"verb":"%s"}' "$verb")
    hash=$(printf '%s' "${prev}|${payload}" | sha256sum | cut -d' ' -f1)
    # The first row's prev_hash is NULL, not an absent argument: the file has to read the same way
    # the writer writes it, or the fixture would be testing a different shape.
    prev_sql="NULL"
    [ -n "$prev" ] && prev_sql="'$prev'"
    if [ -n "$age" ]; then
      out="$(app "SET cms.actor='system:cli'; INSERT INTO audit_log (timestamp,verb,entity,result,entry_hash,prev_hash) VALUES (now() - interval '$age','$verb','contest','success','$hash',$prev_sql) RETURNING id")"
    else
      out="$(app "SET cms.actor='system:cli'; INSERT INTO audit_log (verb,entity,result,entry_hash,prev_hash) VALUES ('$verb','contest','success','$hash',$prev_sql) RETURNING id")"
    fi
    case "$out" in ''|*ERROR*) bad "seeding the fixture ($verb) failed: $out"; seed=1; return 1 ;; esac
    prev="$hash"
  }
  seed_row 'ancient:one' '500 days' || seed=1
  seed_row 'ancient:two' '450 days' || seed=1
  for verb in durability:one durability:two durability:three; do
    seed_row "$verb" || { seed=1; break; }
  done
  check "the fixture seeded five chained rows" "0" "$seed"

  out="$(app_actor "UPDATE audit_log SET verb='tampered' WHERE verb='durability:one'")"
  case "$out" in
    *"permission denied"*|*"append-only"*) ok "UPDATE is refused with an error, not 0 rows" ;;
    *"UPDATE 0"*) bad "UPDATE silently matched zero rows — that is the behaviour this change removes" ;;
    *) bad "UPDATE gave an unexpected answer: $out" ;;
  esac

  out="$(app_actor "DELETE FROM audit_log WHERE verb='durability:one'")"
  case "$out" in
    *"append-only"*) ok "DELETE names the append-only rule" ;;
    *) bad "DELETE was not refused by the guard: $out" ;;
  esac

  out="$(app_actor "TRUNCATE audit_log")"
  case "$out" in
    *"permission denied"*|*"append-only"*) ok "TRUNCATE is refused (row security never covered it)" ;;
    *) bad "TRUNCATE was not refused: $out" ;;
  esac

  count_sql="SET cms.actor='system:cli'; SELECT count(*) FROM audit_log"
  check "no refusal deleted anything" "5" "$(app "$count_sql")"

  out="$(cli verify)"; rc=$?
  check "a valid chain verifies (exit 0)" "0" "$rc"

  # Retention: the one identity allowed to delete is still refused a row inside the window — that is
  # the difference between "retention may delete" and "retention may delete anything".
  out="$(app "SET cms.actor='system:audit-retention'; DELETE FROM audit_log WHERE verb='durability:one'")"
  case "$out" in
    *"inside the 400-day window"*) ok "the retention identity cannot delete a row inside the window" ;;
    *"append-only"*) bad "retention was refused for the wrong reason: $out" ;;
    *) bad "retention deleted (or silently skipped) a row inside the window: $out" ;;
  esac

  anchors_sql="SET cms.actor='system:cli'; SELECT count(*) FROM audit_log_retention"
  before="$(app "$anchors_sql")"
  out="$(cli prune)"; rc=$?
  check "a dry run succeeds" "0" "$rc"
  check "a dry run deletes nothing" "$before" "$(app "$anchors_sql")"
  check "a dry run deletes no row" "5" "$(app "$count_sql")"

  out="$(cli prune --apply)"; rc=$?
  check "an apply succeeds" "0" "$rc"
  check "the prune wrote exactly one anchor" "$((before + 1))" "$(app "$anchors_sql")"
  check "both rows past the window were pruned" "3" "$(app "$count_sql")"
  check "the surviving rows are the recent ones" "3" "$(app "SET cms.actor='system:cli'; SELECT count(*) FROM audit_log WHERE verb LIKE 'durability:%'")"

  out="$(cli verify)"; rc=$?
  check "the chain still verifies across a retention boundary (exit 0)" "0" "$rc"
  case "$out" in
    *"anchors=1"*) ok "the verifier counted the boundary anchor" ;;
    *) bad "the verifier did not see the anchor: $out" ;;
  esac

  # Tampering as somebody who CAN disable the guard: the ownership separation is what stops the app
  # role from doing this, so the suite emulates the stronger attacker and checks detection.
  if [ -n "$SU_URL" ]; then
    su "ALTER TABLE audit_log DISABLE TRIGGER cms_audit_log_append_only" >/dev/null
    su "ALTER TABLE audit_log DISABLE TRIGGER cms_audit_log_no_bulk_write" >/dev/null
    su "UPDATE audit_log SET verb='rewritten' WHERE verb='durability:two'" >/dev/null
    out="$(cli verify)"; rc=$?
    check "an edited row breaks the verification (exit 1)" "1" "$rc"
    case "$out" in
      *"BROKEN"*) ok "the failure names the row it could not re-derive" ;;
      *) bad "the verifier failed without naming the row: $out" ;;
    esac
    su "UPDATE audit_log SET verb='durability:two' WHERE verb='rewritten'" >/dev/null

    # A hole in the middle: no anchor explains it, so it is a deletion, not retention. The row
    # removed is deliberately NOT the newest one — truncating the tip leaves a shorter but
    # internally consistent chain, which nothing inside the chain can detect. That limit is
    # documented in docs/QUICKREF.md rather than papered over here.
    su "DELETE FROM audit_log WHERE verb='durability:two'" >/dev/null
    out="$(cli verify)"; rc=$?
    check "a missing row in the middle fails (exit 1)" "1" "$rc"
    case "$out" in
      *"GAP"*|*"prev_hash"*) ok "the failure reads as a missing row, not a bad hash alone" ;;
      *) bad "the gap was not called a gap: $out" ;;
    esac

    su "ALTER TABLE audit_log ENABLE TRIGGER cms_audit_log_append_only" >/dev/null
    su "ALTER TABLE audit_log ENABLE TRIGGER cms_audit_log_no_bulk_write" >/dev/null
  else
    printf '  [skip] tamper checks need CMS_AUDIT_TEST_SUPERUSER_URL\n'
  fi

  # An unreachable database is exit 2 — "could not check" must never read as "checked, fine".
  ( cd "$REPO_ROOT/admin-panel" && DATABASE_URL='postgresql://cmsuser:wrong@127.0.0.1:59999/nope' AUTH_SECRET=test \
      bun run scripts/audit-log.ts verify >/dev/null 2>&1 )
  check "an unreadable log exits 2, never 0" "2" "$?"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
