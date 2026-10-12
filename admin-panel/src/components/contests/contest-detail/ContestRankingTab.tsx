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

  return <RankingTable ranking={ranking} />;
}
