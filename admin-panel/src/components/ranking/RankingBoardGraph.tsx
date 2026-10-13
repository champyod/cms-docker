'use client';

import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { useChartLabelToggle } from '@/hooks/useChartLabelToggle';
import {
  ScoreProgressChart,
  type ScoreChartEntry,
} from '@/components/ranking/ScoreProgressChart';

export interface RankingBoardGraphProps {
  /** Entries to graph (e.g. first board page). */
  readonly entries: readonly ScoreChartEntry[];
  /** Maximum score possible for the contest or dataset. */
  readonly maxScore?: number;
  /** Section title. Defaults to 'Score Progress Overview'. */
  readonly title?: string;
}

/**
 * Client wrapper for the ranking score progress graph.
 * Provides controls for independently toggling X-axis and Y-axis labels.
 */
export function RankingBoardGraph({
  entries,
  maxScore,
  title = 'Score Progress Overview',
}: RankingBoardGraphProps): React.JSX.Element {
  const { showXLabels, showYLabels, toggleXLabels, toggleYLabels } =
    useChartLabelToggle(true);

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">
            Displaying participant score progress for the current board page.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={showXLabels ? EyeOff : Eye}
            onClick={toggleXLabels}
            title={showXLabels ? 'Hide numerical score labels on X-axis' : 'Show numerical score labels on X-axis'}
          >
            {showXLabels ? 'Hide X labels' : 'Show X labels'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={showYLabels ? EyeOff : Eye}
            onClick={toggleYLabels}
            title={showYLabels ? 'Hide participant name labels on Y-axis' : 'Show participant name labels on Y-axis'}
          >
            {showYLabels ? 'Hide Y labels' : 'Show Y labels'}
          </Button>
        </div>
      </div>

      <ScoreProgressChart
        entries={entries}
        showXLabels={showXLabels}
        showYLabels={showYLabels}
        maxScore={maxScore}
      />
    </div>
  );
}
