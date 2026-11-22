-- 20261122191000_ranking_session_revocation/migration.sql — revoke the console sessions at the source.
-- WHY: the panel changes credentials and permissions in several unrelated actions; a trigger on the
-- tables that actually hold those facts covers every caller, including a future one, without a list
-- of call sites that can drift.

CREATE OR REPLACE FUNCTION public.cms_revoke_ranking_sessions_for_admin_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.ranking_sessions WHERE admin_id = COALESCE(NEW.id, OLD.id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.cms_revoke_ranking_sessions_for_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.ranking_sessions WHERE admin_id = COALESCE(NEW.admin_id, OLD.admin_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS cms_admins_revoke_ranking_sessions ON public.admins;
CREATE TRIGGER cms_admins_revoke_ranking_sessions
AFTER UPDATE OF authentication, enabled, username ON public.admins
FOR EACH ROW EXECUTE FUNCTION public.cms_revoke_ranking_sessions_for_admin_row();

DROP TRIGGER IF EXISTS cms_admin_groups_revoke_ranking_sessions ON public.admin_groups;
CREATE TRIGGER cms_admin_groups_revoke_ranking_sessions
AFTER INSERT OR UPDATE OR DELETE ON public.admin_groups
FOR EACH ROW EXECUTE FUNCTION public.cms_revoke_ranking_sessions_for_member();

DROP TRIGGER IF EXISTS cms_admin_overrides_revoke_ranking_sessions ON public.admin_permission_overrides;
CREATE TRIGGER cms_admin_overrides_revoke_ranking_sessions
AFTER INSERT OR UPDATE OR DELETE ON public.admin_permission_overrides
FOR EACH ROW EXECUTE FUNCTION public.cms_revoke_ranking_sessions_for_member();
