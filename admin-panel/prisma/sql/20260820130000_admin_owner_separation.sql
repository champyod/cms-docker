-- superuser-only

-- 20260820130000_admin_owner_separation.sql — move `admins` (and its sequence/trigger function) off cmsuser.
-- WHY: an owner can disable a trigger or drop a policy; detection is only a control once the app role is not the owner.
DO $$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_platform_owner')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_platform_migrator') THEN
    RAISE NOTICE 'cms_platform_owner/cms_platform_migrator missing — skipping admins ownership separation';
    RETURN;
  END IF;

  EXECUTE 'GRANT cms_platform_owner TO cms_platform_migrator';
  EXECUTE 'GRANT cmsuser TO cms_platform_migrator';
  EXECUTE 'GRANT cmsuser TO cms_platform_owner';

  IF to_regclass('public.admins') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.admins OWNER TO cms_platform_owner';
    EXECUTE 'ALTER SEQUENCE public.admins_id_seq OWNER TO cms_platform_owner';

    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.admins FROM cmsuser CASCADE';
    FOR r IN
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'admins'
    LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES (%I) ON TABLE public.admins FROM cmsuser CASCADE', r.column_name);
    END LOOP;

    EXECUTE 'GRANT SELECT ON TABLE public.admins TO cmsuser';
    EXECUTE 'GRANT UPDATE (last_login_at) ON TABLE public.admins TO cmsuser';
  END IF;

  IF to_regprocedure('public.cms_admin_security_audit()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.cms_admin_security_audit() OWNER TO cms_platform_owner';
  END IF;

  IF to_regclass('public.audit_log') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.audit_log TO cms_platform_owner';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.audit_log_id_seq TO cms_platform_owner';
  END IF;
END $$;
