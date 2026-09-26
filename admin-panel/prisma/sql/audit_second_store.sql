-- WHY explicit opt-in: the application's SQL runner scans this directory but must
-- never provision a privileged database or receive its administration credentials.
\set ON_ERROR_STOP on
\if :{?audit_second_store_setup}
\else
  \echo 'Skipping standalone audit store (audit_second_store_setup not supplied).'
  \quit
\endif
SET search_path = pg_catalog, pg_temp;
\if :audit_second_store_setup
\else
  DO $$
  BEGIN
    RAISE EXCEPTION 'audit_second_store_setup must be a true value when supplied';
  END $$;
\endif

\set audit_writer_password ''
\getenv audit_writer_password CMS_AUDIT_WRITER_PASSWORD
SELECT length($1::text) > 0 AS audit_password_present
\bind :audit_writer_password
\gset
\if :audit_password_present
\else
  DO $$
  BEGIN
    RAISE EXCEPTION 'CMS_AUDIT_WRITER_PASSWORD must contain a generated random password';
  END $$;
\endif

-- WHY a trusted superuser: neither application ownership nor backup membership
-- may become an ownership path into the independent store.
DO $$
BEGIN
  IF current_user = 'cms_audit_writer' OR
     NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Standalone audit setup requires a separate trusted superuser';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles r
      ON r.oid = m.member OR r.oid = m.roleid
    WHERE r.rolname = 'cms_audit_writer'
  ) THEN
    RAISE EXCEPTION 'cms_audit_writer must have no role memberships in either direction';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_database WHERE datname = 'cms_audit'
      AND datdba <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ) THEN
    RAISE EXCEPTION 'cms_audit must be owned by the trusted setup role';
  END IF;
END $$;

-- WHY gexec rather than DO: CREATE DATABASE cannot execute in a transaction.
SELECT NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'cms_audit')
  AS is_audit_database_new \gset
\if :is_audit_database_new
SELECT format('CREATE DATABASE cms_audit OWNER %I TEMPLATE template0 CONNECTION LIMIT 0', current_user)
\gexec
\endif
\connect cms_audit
SET search_path = pg_catalog, pg_temp;
BEGIN;
DO $$
BEGIN
  IF current_user = 'cms_audit_writer' OR
     NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Standalone audit setup requires a separate trusted superuser';
  END IF;
  IF (SELECT datdba FROM pg_database WHERE datname = current_database()) <>
     (SELECT oid FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'cms_audit must be owned by the trusted setup role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles r
      ON r.oid = m.member OR r.oid = m.roleid
    WHERE r.rolname = 'cms_audit_writer'
  ) THEN
    RAISE EXCEPTION 'cms_audit_writer must have no role memberships in either direction';
  END IF;
END $$;

-- WHY these exact types/defaults: source row copies must retain the Prisma audit
-- representation. No cross-database actor FK is possible; its cascades would
-- also mutate historical evidence. The writer supplies the original id so no
-- sequence privilege is needed, while BIGSERIAL mirrors the source default.
CREATE TABLE IF NOT EXISTS public.audit_log (
  id BIGSERIAL NOT NULL,
  actor_id INTEGER,
  timestamp TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verb VARCHAR NOT NULL,
  entity VARCHAR NOT NULL,
  entity_id VARCHAR,
  before_values JSONB,
  after_values JSONB,
  reason VARCHAR,
  ip VARCHAR,
  session_id VARCHAR,
  result VARCHAR NOT NULL,
  entry_hash VARCHAR,
  prev_hash VARCHAR,
  CONSTRAINT audit_log_pkey PRIMARY KEY (id)
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = 'public.audit_log'::regclass
      AND relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND relkind = 'r' AND relpersistence = 'p'
  ) THEN
    RAISE EXCEPTION 'audit_log must be a permanent table owned by the trusted setup role';
  END IF;
  IF (SELECT array_agg(format('%s:%s:%s', attname, format_type(atttypid, atttypmod), attnotnull)
                      ORDER BY attnum)
      FROM pg_attribute WHERE attrelid = 'public.audit_log'::regclass
        AND attnum > 0 AND NOT attisdropped) IS DISTINCT FROM ARRAY[
    'id:bigint:t', 'actor_id:integer:f', 'timestamp:timestamp(6) without time zone:t',
    'verb:character varying:t', 'entity:character varying:t', 'entity_id:character varying:f',
    'before_values:jsonb:f', 'after_values:jsonb:f', 'reason:character varying:f',
    'ip:character varying:f', 'session_id:character varying:f', 'result:character varying:t',
    'entry_hash:character varying:f', 'prev_hash:character varying:f'
  ] OR EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid = 'public.audit_log'::regclass
      AND attnum > 0 AND NOT attisdropped AND (attidentity <> '' OR attgenerated <> '')
  ) THEN
    RAISE EXCEPTION 'audit_log columns do not match the expected schema';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.audit_log'::regclass
      AND contype = 'p' AND NOT condeferrable
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                         WHERE attrelid = 'public.audit_log'::regclass AND attname = 'id')]
  ) THEN
    RAISE EXCEPTION 'audit_log must have a nondeferrable primary key on id';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_audit_writer') THEN
    CREATE ROLE cms_audit_writer NOLOGIN;
  END IF;
END $$;

REVOKE ALL PRIVILEGES ON DATABASE cms_audit FROM PUBLIC, cms_audit_writer;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC, cms_audit_writer;
GRANT USAGE ON SCHEMA public TO cms_audit_writer;
CREATE INDEX IF NOT EXISTS ix_audit_log_actor_id ON public.audit_log(actor_id);
CREATE INDEX IF NOT EXISTS ix_audit_log_entity ON public.audit_log(entity);
CREATE INDEX IF NOT EXISTS ix_audit_log_timestamp ON public.audit_log(timestamp);

-- WHY reset ACLs before granting: reruns must not retain UPDATE, DELETE, TRUNCATE,
-- REFERENCES, TRIGGER or grant options; RLS alone cannot restrict a table owner.
-- WHY column-list revoke: a table-level REVOKE ALL does not drop pre-existing
-- column grants; per PG18 docs only a column-list REVOKE removes them.
REVOKE ALL PRIVILEGES (id, actor_id, timestamp, verb, entity, entity_id,
  before_values, after_values, reason, ip, session_id, result,
  entry_hash, prev_hash) ON public.audit_log FROM PUBLIC, cms_audit_writer;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, cms_audit_writer;
GRANT SELECT, INSERT ON public.audit_log TO cms_audit_writer;
-- WHY no sequence access: source IDs need neither nextval nor setval, so stolen
-- credentials cannot manipulate the independent store's allocator.
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, cms_audit_writer;
-- WHY no callable helpers: a future privileged function must not create an
-- alternate mutation path merely through PostgreSQL's default PUBLIC EXECUTE.
REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, cms_audit_writer;

-- WHY global and schema defaults: schema-local revokes cannot cancel global
-- defaults. These apply to objects made by this setup owner, not other creators.
ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM PUBLIC, cms_audit_writer;
ALTER DEFAULT PRIVILEGES REVOKE ALL ON SEQUENCES FROM PUBLIC, cms_audit_writer;
ALTER DEFAULT PRIVILEGES REVOKE ALL ON ROUTINES FROM PUBLIC, cms_audit_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, cms_audit_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, cms_audit_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM PUBLIC, cms_audit_writer;
SET LOCAL password_encryption = 'scram-sha-256';
ALTER ROLE cms_audit_writer WITH LOGIN NOSUPERUSER NOBYPASSRLS
  NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT
  PASSWORD :'audit_writer_password';
\unset audit_writer_password
GRANT CONNECT ON DATABASE cms_audit TO cms_audit_writer;
\if :is_audit_database_new
ALTER DATABASE cms_audit CONNECTION LIMIT -1;
\endif
COMMIT;
