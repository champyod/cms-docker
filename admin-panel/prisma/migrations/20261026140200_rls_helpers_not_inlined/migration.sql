-- WHY this migration exists: the RLS predicate helpers are one-line SQL functions, and Postgres
-- inlines those into the policy expression — so `cms_actor_is_staff()` was re-evaluated once per
-- ROW: a regex, two split_parts and two array comparisons times 34,610 rows, on every query the
-- panel makes. Measured with EXPLAIN on the live database: 25 ms of a 55 ms GROUP BY, 9,413 heap
-- fetches, and the same cost on every paged read.
--
-- A SET clause makes a SQL function non-inlinable, so the identity is resolved once per statement.
-- Pinning search_path at the same time is the other half of what makes a policy helper safe to
-- call. The bodies are unchanged — this migration only recreates them with that clause.
--
-- Generated from scripts/__generate_rls_sql.sh (the source of truth); a future regeneration
-- reproduces exactly this text.

CREATE OR REPLACE FUNCTION public.cms_actor() RETURNS text
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $$
    SELECT nullif(current_setting('cms.actor', true), '')
  $$;
CREATE OR REPLACE FUNCTION public.cms_actor_admin_id() RETURNS integer
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $$
    SELECT CASE
             WHEN public.cms_actor() ~ '^admin:[0-9]{1,9}$'
             THEN split_part(public.cms_actor(), ':', 2)::integer
           END
  $$;
CREATE OR REPLACE FUNCTION public.cms_actor_any(names text[]) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $$
    SELECT public.cms_actor() LIKE 'system:%' AND public.cms_actor() = ANY(names)
  $$;
CREATE OR REPLACE FUNCTION public.cms_actor_is_staff() RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $$
    SELECT public.cms_actor_admin_id() IS NOT NULL
        OR public.cms_actor_any(ARRAY['system:core', 'system:cli', 'system:migration', 'system:scheduler'])
  $$;
CREATE OR REPLACE FUNCTION public.cms_actor_is_staff_or_auth() RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $$
    SELECT public.cms_actor_admin_id() IS NOT NULL
        OR public.cms_actor_any(ARRAY['system:core', 'system:cli', 'system:migration', 'system:scheduler', 'system:auth'])
  $$;
