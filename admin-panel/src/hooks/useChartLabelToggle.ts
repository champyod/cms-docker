'use client';

import { useCallback, useState } from 'react';

export interface ChartLabelToggleState {
  readonly showXLabels: boolean;
  readonly showYLabels: boolean;
  readonly toggleXLabels: () => void;
  readonly toggleYLabels: () => void;
}

/**
 * Manages independent visibility of X-axis and Y-axis labels for ranking charts.
 * Both axes start visible by default; each can be toggled independently.
 */
export function useChartLabelToggle(initialShow: boolean = true): ChartLabelToggleState {
  const [showXLabels, setShowXLabels] = useState<boolean>(initialShow);
  const [showYLabels, setShowYLabels] = useState<boolean>(initialShow);

  const toggleXLabels = useCallback(() => {
    setShowXLabels((prev) => !prev);
  }, []);

  const toggleYLabels = useCallback(() => {
    setShowYLabels((prev) => !prev);
  }, []);

  return {
    showXLabels,
    showYLabels,
    toggleXLabels,
    toggleYLabels,
  };
}
