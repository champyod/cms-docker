-- 20260820119000_admin_role_passwords.sql — set the credentials of the three admin roles.
-- superuser-only
--
-- WHY superuser: 20260820110000_generated_roles.sql creates every LOGIN role with PASSWORD NULL,
-- and only a superuser may set a password on a role it does not own. Production's cmsuser is
-- NOCREATEROLE, so scripts/__apply_sql.sh applies this file in the --bootstrap-roles superuser
-- phase and the normal (application-role) apply skips it.
-- WHY a psql variable: the repository never holds the secret; __apply_sql.sh hands each value in
-- the same way 20260820125000_backup_role.sql receives cms_backup_password.
-- WHY idempotent: ALTER ROLE ... PASSWORD is a set, and an empty or absent variable leaves the
-- existing credential alone rather than clearing it on a re-apply.

SELECT set_config('my.admin_login_password', :'admin_login_password', false);
SELECT set_config('my.admin_read_password', :'admin_read_password', false);
SELECT set_config('my.admin_security_password', :'admin_security_password', false);
DO $$
DECLARE
  r record;
  _pw text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('cms_admin_login', current_setting('my.admin_login_password', true)),
      ('cms_admin_read_people', current_setting('my.admin_read_password', true)),
      ('cms_admin_account_security', current_setting('my.admin_security_password', true))
    ) AS v(rolname, password)
  LOOP
    _pw := coalesce(r.password, '');
    IF _pw <> '' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.rolname) THEN
      EXECUTE format('ALTER ROLE %I WITH PASSWORD %L', r.rolname, _pw);
    END IF;
  END LOOP;
END $$;
