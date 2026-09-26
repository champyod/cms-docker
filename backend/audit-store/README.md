# Independent audit store

`cms_audit` is a dedicated PostgreSQL database with a `public.audit_log` table.
Use an independent PostgreSQL cluster: a separate database in the primary CMS
cluster does not separate audit data from that cluster's superusers. Keep audit
administration credentials and access independent of the primary CMS.
This setup does not upgrade or modify the primary CMS database, its RLS,
application-owner demotion, or backup BYPASSRLS/membership configuration.
Rust application wiring is not included.

## Requirements

Require a PostgreSQL 18 server and PostgreSQL 18 `psql` for this deployment.
The script uses `psql`'s `\bind` command; older clients are not suitable.
The [official versioning page](https://www.postgresql.org/support/versioning/)
listed 18.6 as the latest stable release when retrieved for this documentation.
Use 18.6 as the recorded baseline, not a floating `latest` version. Review future
18.x maintenance releases and deliberately update pinned server/client versions.
The SQL does not itself enforce these version requirements.

Configure matching `pg_hba.conf` rules to require `scram-sha-256` authentication
for administrative and writer connections; do not allow a matching `trust` rule
to bypass authentication. The script sets `password_encryption` to SCRAM for the
writer password, but password storage alone does not configure authentication.
For remote connections, require TLS with `sslmode=verify-full` and a trusted CA,
including the script's reconnection to `cms_audit`.

Run provisioning outside the CMS container as a separate trusted superuser.
Use a protected administrative credential file, such as a permission-restricted
passfile, and a protected connection service configuration. Select the independent
cluster and an existing administrative database; never expose these credentials
to the CMS. Do not use `PGPASSWORD` as the recommended credential mechanism.
Supply `CMS_AUDIT_WRITER_PASSWORD` from a secret manager with an independently
generated random value (at least 32 random bytes). The SQL checks only that this
value is nonempty, not its entropy. Never log or echo secrets: disable shell
tracing and client SQL echoing, and ensure statement, parameter, error, and audit
logging cannot capture the password-bearing SQL or its values.

## Provisioning

From the repository root containing `admin-panel` and `backend`:

```sh
psql -X -v ON_ERROR_STOP=1 -v audit_second_store_setup=1 \
  -f admin-panel/prisma/sql/audit_second_store.sql
```

Do not use `--single-transaction`: guarded `CREATE DATABASE` requires autocommit.
Without the opt-in variable the script skips setup; an explicitly false value
fails. Provision into a fresh dedicated database and rerun as the same trusted
owner. A successful rerun with a different secret rotates the writer password.
The script rejects writer role memberships in either direction and requires
both the database and audit table to belong to the trusted setup role.

A new database is created with `CONNECTION LIMIT 0` before transactional setup.
The script opens it to ordinary connections only when that same invocation
successfully commits. A failure after database creation can leave the database
present with `CONNECTION LIMIT 0`; rerunning will not automatically open it,
even if the rerun otherwise succeeds. An operator must inspect the failure and
remaining database state, resolve the cause, and deliberately decide when the
store is safe to open. Do not treat rerunning as automatic recovery.

Existing-schema checks are partial: they verify a permanent ordinary table,
ownership, ordered column names/types/nullability, no identity/generated columns,
and a nondeferrable primary key on `id`. They do not fully validate defaults,
existing index definitions, triggers, other constraints, or arbitrary existing
database contents and third-party ACLs. `IF NOT EXISTS` is not reconciliation.
Keep unrelated roles, extensions, and privileged functions out of this database.
Default privilege restrictions apply only to objects created by the setup owner.

## Writer access and integration

The SQL grants `cms_audit_writer` database CONNECT, public schema USAGE, and
SELECT/INSERT on `public.audit_log`, without ownership or role memberships.
It resets PUBLIC/writer privileges on the database, public schema, and its tables,
sequences, and routines before granting the intended access. The writer has no
sequence privileges: future row copying must supply the original `id` explicitly.
The BIGSERIAL default remains for schema fidelity, not writer allocation.
There is no actor foreign key: PostgreSQL cannot reference another database,
and source actor deletion must not rewrite stored evidence.

`CMS_AUDIT_WRITER_PASSWORD` is consumed by the provisioning SQL. The Rust
`cms-audit` crate consumes the writer credentials out of band; nothing is read
from the process environment by the crate itself. Any connection
must use only writer credentials for `cms_audit`.

## Threat boundary and verification limits

The intended SQL privilege boundary denies writer UPDATE, DELETE, TRUNCATE,
and table creation. The CMS must never receive audit-owner or backup credentials,
host access, or a Docker socket. An independent cluster separates primary CMS
superusers from the audit store only if its administration and access remain
separate. Sharing a host does not protect against that host's root user.
Audit-cluster superusers, trusted owners, privileged backups, and offline
restore/replacement remain outside this boundary. Forged inserts, skipped events,
resource exhaustion, and dishonest hashes are also not prevented.

## Test invocation

`admin-panel/prisma/sql/tests/audit_second_store_test.sh` verifies the
provisioning SQL against a throwaway PostgreSQL cluster. Before running it,
ensure all of the following are satisfied; the script refuses to run otherwise:

- `COMMANDCODE_SCRATCHPAD` is set to an existing, writable absolute directory.
  The cluster is created there (`audit-second.XXXXXXXX`) and requires temp disk.
- Installed PostgreSQL 18+ binaries `initdb`, `pg_ctl`, `postgres`, and `psql`
  at `/bin`, plus `openssl`, `mktemp`, `chmod`, and `rm` on `PATH`.
- `shellcheck` if you use it to lint the script first.
- No network access is needed: nothing is downloaded.
- Run as an unprivileged user (not root, no sudo), on Linux (`/proc/self/cwd`
  is required for a short private Unix-socket path). No PostgreSQL environment
  variables may be set; the script unsets them.

The script initializes a private cluster on port 55432 listening only on a
local Unix socket, with SCRAM enforced for the writer and all TCP and other
local connections rejected, then removes the work directory on exit after a
confirmed fast shutdown; if shutdown cannot be confirmed it retains the
directory and exits nonzero. Invoke it from the repository root:

```sh
COMMANDCODE_SCRATCHPAD=/absolute/writable/dir \
  bash admin-panel/prisma/sql/tests/audit_second_store_test.sh
```

A successful run prints `PASS: isolated audit second-store tests`.

## Verified scope

The script was actually run against installed PostgreSQL 18.6 binaries
(`bash -n`, `shellcheck`, then the script itself) and exited 0 with that PASS
line, with cleanup confirmed (no leftover `audit-second.*` directories or
matching `postgres` processes). Runtime behavior verified by that run covers:
opt-in gating including missing/empty password rejection, the
`CONNECTION LIMIT 0` retained on failed new-database creation, SCRAM
authentication for the writer (wrong-password rejection), writer role
attributes/ownership checks, read and explicit-`id` insert allowed, INSERT
without `id` denied for sequence privileges, UPDATE/DELETE/TRUNCATE/CREATE
TABLE/CREATE TEMP TABLE/ALTER/DROP denied with SQLSTATE 42501, injected column
UPDATE grants reset by a rotation rerun, password rotation changing the
verifier while preserving data and revoking the old password, and rerun
failure on schema mismatch without changing the password or data.

Not proven by this run: event delivery, concurrency, and hash-chain
integrity. The other static caveats above — verification limits of
existing-schema checks, recovery being a deliberate operator decision, and the
threat boundary — were checked against the provisioning SQL, not exercised at
runtime beyond what the script covers.

## Rust writer

`cms-audit` (in `backend/cms-audit`) writes to the store with SQLx. It mirrors
every `audit_log` column, supplies the original `id` on every insert because the
writer has no sequence privilege, and uses bound parameters rather than
interpolated SQL. Connections are configured for full certificate and hostname
verification; a deployment behind a private CA must pass that CA explicitly, and
otherwise the platform trust store applies.

### Rust writer test

`backend/cms-audit/tests/store_tls_test.sh` starts a throwaway TLS cluster with
a private CA, provisions it with the same provisioning SQL, then runs the
`cms-audit` integration test against it. It requires `COMMANDCODE_SCRATCHPAD`,
installed PostgreSQL 18+ binaries, and `openssl`; nothing is downloaded, and the
cluster is removed after a confirmed shutdown.

```sh
COMMANDCODE_SCRATCHPAD=/absolute/writable/dir \
  bash backend/cms-audit/tests/store_tls_test.sh
```

The integration test connects with `verify-full` over TLS using SCRAM, appends a
row, reads it back, and asserts that an UPDATE is refused. It runs only when the
`CMS_AUDIT_TEST_*` variables are set, so an ordinary `cargo test` skips it and
stays offline. A successful run prints
`PASS: cms-audit writer verified against an isolated TLS store`.

Verified on the installed PostgreSQL 18.6 toolchain: the writer authenticated
with SCRAM over a verified TLS channel, the row was written and read back, and
the UPDATE was refused by the store's grant boundary. Not proven: concurrent
writers, hash-chain continuity across the two databases, and application-level
delivery guarantees.
