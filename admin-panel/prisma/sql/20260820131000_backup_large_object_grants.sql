-- superuser-only

-- 20260820131000_backup_large_object_grants.sql — a SELECT grant on pg_largeobject is not enough.
-- WHY: large objects carry object-level ACLs; after the cmsuser membership was removed, pg_dump
-- still fails on every large object unless the object itself grants SELECT to cms_backup. This
-- backfills every existing object. New objects are granted by the application at creation.
DO $$
DECLARE
  r record;
  granted integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_backup') THEN
    RAISE NOTICE 'cms_backup is missing — skipping large-object grants';
    RETURN;
  END IF;

  FOR r IN
    SELECT m.oid
      FROM pg_largeobject_metadata m
     WHERE m.lomacl IS NULL
        OR NOT EXISTS (
             SELECT 1
               FROM aclexplode(m.lomacl) a
               JOIN pg_roles grantee ON grantee.oid = a.grantee
              WHERE grantee.rolname = 'cms_backup'
                AND a.privilege_type = 'SELECT'
           )
  LOOP
    EXECUTE format('GRANT SELECT ON LARGE OBJECT %s TO cms_backup', r.oid);
    granted := granted + 1;
  END LOOP;

  RAISE NOTICE 'backup large-object grants: % object(s) newly granted', granted;
END $$;
