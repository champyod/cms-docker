'use client';

import { useEffect, useState } from 'react';

import { getRanking } from '@/app/actions/ranking';
import { SurfaceLoadState } from '@/components/core/SurfaceLoadState';
import { useDictionary } from '@/hooks/useDictionary';
import { surfaceLoadMessages, useSurfaceLoad } from '@/hooks/useSurfaceLoad';
import {
  RankingTable,
  type RankingEntry,
  type TaskCol,
} from '@/components/contests/contest-detail/RankingTable';
import { RankingBoardGraph } from '@/components/ranking/RankingBoardGraph';

export type ContestRankingTabProps = {
  contestId: number;
};

type RankingPayload = { ranking: RankingEntry[]; tasks: TaskCol[] };

/**
 * The contest's own scoreboard.
 *
 * WHY this is a tab of its own: it used to be the third tab inside Communications,
 * beside announcements and questions, which framed a scoreboard as a message. It reads
 * the same action the Communications tab used to call, so nothing about the data moved
 * — only where an operator finds it.
 */
export function ContestRankingTab({ contestId }: ContestRankingTabProps): React.JSX.Element {
  const dict = useDictionary();
  const [ranking, setRanking] = useState<RankingPayload | null>(null);

  const load = async (): Promise<void> => {
    setRanking((await getRanking(contestId)) as RankingPayload);
  };

  const { status, reload } = useSurfaceLoad(load, surfaceLoadMessages(dict));

  // The contest is fixed by the route, so the board loads once on mount. A reload is
  // driven by the tab's own retry control, not by a dependency on the id.
  useEffect(() => {
    void reload();
  }, [reload]);

  if (status.kind !== 'idle') {
    return (
      <SurfaceLoadState
        status={status}
        loadingTitle="Loading..."
        onRetry={reload}
        retryLabel={dict.states.retry.label}
      />
    );
  }

  const firstPageSlice = ranking?.ranking.slice(0, 20).map((entry) => ({
    rank: entry.rank,
    username: entry.user.username,
    displayName: entry.user.username,
    totalScore: entry.totalScore,
  })) ?? [];

  return (
    <div className="w-full space-y-6">
      <RankingTable ranking={ranking} />
      {firstPageSlice.length > 0 ? (
        <div className="w-full rounded-xl border border-border bg-card p-6 shadow-xs">
          <RankingBoardGraph
            entries={firstPageSlice}
            title="Score Progress Overview"
          />
        </div>
      ) : null}
    </div>
  );
}
