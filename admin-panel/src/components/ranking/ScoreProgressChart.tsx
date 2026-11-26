'use client';

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

export interface ScoreChartEntry {
  readonly rank: number;
  readonly username: string;
  readonly displayName?: string;
  readonly totalScore: number;
}

export interface ScoreProgressChartProps {
  /** Ranking entries to display (e.g. first board page). */
  readonly entries: readonly ScoreChartEntry[];
  /** Whether to show X-axis labels (numerical score values). */
  readonly showXLabels: boolean;
  /** Whether to show Y-axis labels (participant names/usernames). */
  readonly showYLabels: boolean;
  /** Maximum score possible or highest score to scale percentages against. */
  readonly maxScore?: number;
  /** Optional custom CSS class. */
  readonly className?: string;
}

/**
 * Responsive progress bar chart for contestant scores.
 * Scales fluidly across container widths without fixed sizing.
 * Allows independent toggling of X-axis and Y-axis labels.
 */
export function ScoreProgressChart({
  entries,
  showXLabels,
  showYLabels,
  maxScore: explicitMaxScore,
  className,
}: ScoreProgressChartProps): React.JSX.Element {
  const calculatedMaxScore = useMemo(() => {
    if (explicitMaxScore && explicitMaxScore > 0) return explicitMaxScore;
    const max = Math.max(...entries.map((e) => e.totalScore), 1);
    return max > 0 ? max : 100;
  }, [entries, explicitMaxScore]);

  const ticks = useMemo(() => {
    return [0, 0.25, 0.5, 0.75, 1].map((pct) => ({
      percentage: pct * 100,
      value: Math.round(calculatedMaxScore * pct),
    }));
  }, [calculatedMaxScore]);

  if (entries.length === 0) {
    return (
      <div className="flex h-32 w-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        No scores to display
      </div>
    );
  }

  return (
    <div className={cn('w-full space-y-4 select-none', className)}>
      <div className="space-y-3">
        {entries.map((entry) => {
          const percentage = Math.min(
            100,
            Math.max(0, (entry.totalScore / calculatedMaxScore) * 100),
          );
          const name = entry.displayName || entry.username;

          return (
            <div
              key={`${entry.rank}-${entry.username}`}
              className="group flex items-center gap-3 text-xs"
            >
              {/* Y-Axis: Rank & Name */}
              <div
                className={cn(
                  'flex items-center gap-1.5 transition-all duration-200 shrink-0',
                  showYLabels ? 'w-32 md:w-40' : 'w-8 justify-center',
                )}
              >
                <span className="font-mono text-muted-foreground font-semibold">
                  #{entry.rank}
                </span>
                {showYLabels ? (
                  <span
                    className="truncate font-medium text-foreground"
                    title={`${name} (${entry.username})`}
                  >
                    {name}
                  </span>
                ) : null}
              </div>

              {/* Progress Bar & Visual Bar Track */}
              <div className="relative flex-1">
                <div
                  className="h-5 w-full overflow-hidden rounded-md bg-muted/40 border border-border/50"
                  role="progressbar"
                  aria-valuenow={entry.totalScore}
                  aria-valuemin={0}
                  aria-valuemax={calculatedMaxScore}
                  aria-label={`${name} score`}
                >
                  <div
                    className="h-full rounded-sm bg-primary/80 transition-all duration-500 ease-out group-hover:bg-primary"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>

              {/* Inline Score Value (tied to X-axis labels visibility) */}
              <div className="w-12 text-right shrink-0">
                {showXLabels ? (
                  <span className="font-mono font-medium text-foreground">
                    {entry.totalScore.toFixed(0)}
                  </span>
                ) : (
                  <span className="text-muted-foreground/30 font-mono">•</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* X-Axis Scale & Tick Markers */}
      <div className="border-t border-border/70 pt-2">
        <div className="flex items-center">
          <div
            className={cn(
              'shrink-0 transition-all duration-200',
              showYLabels ? 'w-32 md:w-40' : 'w-8',
            )}
          />
          <div className="relative flex-1 h-5">
            {ticks.map((tick) => (
              <div
                key={tick.percentage}
                className="absolute top-0 -translate-x-1/2 flex flex-col items-center"
                style={{ left: `${tick.percentage}%` }}
              >
                <div className="h-1.5 w-px bg-border" />
                {showXLabels ? (
                  <span className="font-mono text-[10px] text-muted-foreground mt-0.5">
                    {tick.value}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <div className="w-12 shrink-0" />
        </div>
      </div>
    </div>
  );
}
