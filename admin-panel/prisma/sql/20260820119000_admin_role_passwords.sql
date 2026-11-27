-- superuser-only

-- 20260820119000_admin_role_passwords.sql: 20260820110000_generated_roles.sql leaves these roles PASSWORD NULL, so only a superuser can set them.

SELECT set_config('my.admin_login_password', :'admin_login_password', false);
SELECT set_config('my.admin_read_password', :'admin_read_password', false);
SELECT set_config('my.admin_security_password', :'admin_security_password', false);
SELECT set_config('my.admin_migrate_password', :'admin_migrate_password', false);
DO $$
DECLARE
  r record;
  _pw text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('cms_admin_login', current_setting('my.admin_login_password', true)),
      ('cms_admin_read_people', current_setting('my.admin_read_password', true)),
      ('cms_admin_account_security', current_setting('my.admin_security_password', true)),
      ('cms_platform_migrator', current_setting('my.admin_migrate_password', true))
    ) AS v(rolname, password)
  LOOP
    _pw := coalesce(r.password, '');
    IF _pw <> '' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.rolname) THEN
      EXECUTE format('ALTER ROLE %I WITH PASSWORD %L', r.rolname, _pw);
    END IF;
  END LOOP;
END $$;
