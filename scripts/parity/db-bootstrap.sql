-- Parity harness database bootstrap.
--
-- WHY the harness creates its own superuser instead of using cmsuser: the
-- migration history demotes cmsuser to NOCREATEDB NOBYPASSRLS with FORCE row
-- level security (20260820140000_owner_hardening), which is what production
-- runs and must stay that way here. The harness still needs one exact read of
-- the seeded database (CREATE DATABASE … TEMPLATE) that no application role can
-- perform, so the container is initialised with `postgres` as the administrative
-- role and cmsuser keeps the privileges production gives it.

CREATE ROLE cmsuser WITH LOGIN SUPERUSER CREATEDB PASSWORD 'cmsdevpw';
CREATE DATABASE cmsdb OWNER cmsuser;
