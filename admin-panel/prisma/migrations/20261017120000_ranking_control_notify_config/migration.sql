-- Notify listeners that the board's shown set changed.
--
-- WHY this table was missed: 20261009160000_ranking_notify gave every projection table an
-- entity trigger and both control tables one, but ranking_config did not exist yet — it was
-- added later, by 20261016180000_ranking_config, so no trigger ever covered it.
--
-- WHY it breaks without this: the listener in ranking-web/src/feed.rs listens on
-- ranking_control and calls invalidate_standings() for every notification it receives. With
-- no trigger here, an operator adding, ending or reordering a shown contest writes
-- ranking_config and raises nothing, so the cached board keeps drawing the previous shown
-- set until an unrelated write to another table happens to invalidate it.
--
-- WHY the control channel and not the entity one: a config row carries no key the page
-- switches on, and a change to the shown set means the page must refetch the whole board,
-- which is exactly what ranking_control_notify() signals.
CREATE TRIGGER ranking_control_notify_config AFTER INSERT OR UPDATE OR DELETE ON ranking_config
  FOR EACH ROW EXECUTE FUNCTION ranking_control_notify();
