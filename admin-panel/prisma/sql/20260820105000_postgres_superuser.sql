-- The postgres image can create only one superuser at init; when that is cmsuser, the
-- socket-trusted postgres role never exists, and a later demotion leaves no superuser.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres WITH SUPERUSER LOGIN;
  END IF;
END
$$;
