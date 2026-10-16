'use client';

import { RankingTable, type RankingEntry, type TaskCol } from '@/components/contests/contest-detail/RankingTable';
import { RankingBoardGraph } from '@/components/ranking/RankingBoardGraph';

/** What a board read hands a route: the rows and the task columns they score against. */
export interface RankingBoardPayload {
  readonly ranking: RankingEntry[];
  readonly tasks: TaskCol[];
}

export interface RankingBoardSurfaceProps {
  readonly ranking: RankingBoardPayload | null;
  /** The graph's own heading, so a route can say which page its slice is. */
  readonly graphTitle: string;
}

/** The graph summarises the board's first page; the table carries the rest. */
const GRAPH_ROWS = 20;

/**
 * The scoreboard as a reader sees it: the ranking table, then the progress graph over its first
 * page.
 *
 * WHY the two routes share one surface: the board page and a contest's ranking tab show the same
 * pair for one contest, so the slice and the graph's framing live here instead of being written
 * out twice and drifting apart.
 */
export function RankingBoardSurface({
  ranking,
  graphTitle,
}: RankingBoardSurfaceProps): React.JSX.Element {
  const firstPage = (ranking?.ranking ?? []).slice(0, GRAPH_ROWS).map((entry) => ({
    rank: entry.rank,
    username: entry.user.username,
    displayName: entry.user.username,
    totalScore: entry.totalScore,
  }));
  return (
    <div className="space-y-6">
      <RankingTable ranking={ranking} />
      {firstPage.length > 0 ? (
        <div className="border-t border-border/80 pt-6">
          <RankingBoardGraph entries={firstPage} title={graphTitle} />
        </div>
      ) : null}
    </div>
  );
}
