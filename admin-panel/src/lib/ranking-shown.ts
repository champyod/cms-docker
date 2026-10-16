import { loadShownContestIds } from '@/lib/ranking-config-store';

/**
 * The one contest the board shows, resolved from the config that decides it.
 *
 * WHY through the shared read rather than its own query: `ranking_config` is the board's whole
 * answer for what it draws, and `resyncRankingUsers` scopes what it writes to the same set, so a
 * second `findMany` here would be a second spelling of one fact — the defect this surface exists to
 * remove. `loadShownContestIds` also owns the refusal of a declaration the board cannot draw, so a
 * page that renders and a job that writes cannot disagree about what the config says.
 *
 * WHY none for several targets: the reader words a header only for the one contest the config
 * shows, so a caller that must name one is answered only when exactly one is shown — never with the
 * first of several, which would word a heading for a contest the operator did not choose.
 */
export async function readShownContestId(): Promise<number | null> {
  const shown = await loadShownContestIds();
  const [only] = shown;
  return shown.size === 1 ? only : null;
}
