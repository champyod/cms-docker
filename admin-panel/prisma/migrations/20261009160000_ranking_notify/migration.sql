-- Notify listeners that the ranking projection changed.
--
-- WHY a trigger rather than the writer: the proxy writes these tables with plain
-- SQL, and a trigger keeps the notification next to the row it describes, so no
-- writer can forget it. The payload names the table, the operation and the key;
-- the service maps the table to the entity kind the page already switches on.
CREATE OR REPLACE FUNCTION ranking_notify() RETURNS trigger AS $$
DECLARE
  row_key text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_key := OLD.key;
  ELSE
    row_key := NEW.key;
  END IF;
  PERFORM pg_notify('ranking_entities', TG_TABLE_NAME || ' ' || lower(TG_OP) || ' ' || row_key);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Appearance and overrides carry no key, and a change to either means the page
-- must refetch its configuration rather than one row.
CREATE OR REPLACE FUNCTION ranking_control_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('ranking_control', TG_TABLE_NAME || ' ' || lower(TG_OP));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ranking_notify_contests AFTER INSERT OR UPDATE OR DELETE ON ranking_contests
  FOR EACH ROW EXECUTE FUNCTION ranking_notify();
CREATE TRIGGER ranking_notify_tasks AFTER INSERT OR UPDATE OR DELETE ON ranking_tasks
  FOR EACH ROW EXECUTE FUNCTION ranking_notify();
CREATE TRIGGER ranking_notify_teams AFTER INSERT OR UPDATE OR DELETE ON ranking_teams
  FOR EACH ROW EXECUTE FUNCTION ranking_notify();
CREATE TRIGGER ranking_notify_users AFTER INSERT OR UPDATE OR DELETE ON ranking_users
  FOR EACH ROW EXECUTE FUNCTION ranking_notify();
CREATE TRIGGER ranking_notify_submissions AFTER INSERT OR UPDATE OR DELETE ON ranking_submissions
  FOR EACH ROW EXECUTE FUNCTION ranking_notify();
CREATE TRIGGER ranking_notify_subchanges AFTER INSERT OR UPDATE OR DELETE ON ranking_subchanges
  FOR EACH ROW EXECUTE FUNCTION ranking_notify();

CREATE TRIGGER ranking_control_notify_settings AFTER INSERT OR UPDATE OR DELETE ON ranking_settings
  FOR EACH ROW EXECUTE FUNCTION ranking_control_notify();
CREATE TRIGGER ranking_control_notify_overrides AFTER INSERT OR UPDATE OR DELETE ON ranking_overrides
  FOR EACH ROW EXECUTE FUNCTION ranking_control_notify();
