-- WHY this migration undoes 20261026140200: the fix for a 25 ms per-row predicate cost was to make
-- the helpers non-inlinable with a SET clause, on the theory that the identity would then resolve once
-- per statement. It does — and the planner also stops treating the call as an index condition, so the
-- partial index is no longer usable as an index-only scan and the same GROUP BY fell back to a heap
-- scan: 2,279 ms per query, 4,649 ms for the digest, against 51 ms and 114 ms before.
--
-- The per-row evaluation was the cheaper of the two costs. This restores the inlinable bodies exactly
-- as scripts/__generate_rls_sql.sh emits them, in a new migration rather than an edit, because the
-- previous one has already run on the production database.
--
-- The real answer to the cost is not this function: it is that the panel should not be counting a
-- 34,609-row table on every render (see the aggregate/paged read path).

CREATE OR REPLACE FUNCTION public.cms_actor() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('cms.actor', true), '')
  $$;
CREATE OR REPLACE FUNCTION public.cms_actor_admin_id() RETURNS integer
  LANGUAGE sql STABLE AS $$
    SELECT CASE
             WHEN public.cms_actor() ~ '^admin:[0-9]{1,9}$'
             THEN split_part(public.cms_actor(), ':', 2)::integer
           END
  $$;
CREATE OR REPLACE FUNCTION public.cms_actor_any(names text[]) RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT public.cms_actor() LIKE 'system:%' AND public.cms_actor() = ANY(names)
  $$;
CREATE OR REPLACE FUNCTION public.cms_actor_is_staff() RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT public.cms_actor_admin_id() IS NOT NULL
        OR public.cms_actor_any(ARRAY['system:core', 'system:cli', 'system:migration', 'system:scheduler'])
  $$;
CREATE OR REPLACE FUNCTION public.cms_actor_is_staff_or_auth() RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT public.cms_actor_admin_id() IS NOT NULL
        OR public.cms_actor_any(ARRAY['system:core', 'system:cli', 'system:migration', 'system:scheduler', 'system:auth'])
  $$;
