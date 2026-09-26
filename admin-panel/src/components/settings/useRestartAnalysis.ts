'use client';

import { useEffect, useRef, useState } from 'react';
import { analyzeRestartRequirements } from '@/app/actions/services';
import { createSearchScheduler, type SearchScheduler } from '@/components/palette/search-scheduler';
import { EnvFilesData, computeChangedKeys } from './envConfigSections';

// Why 500: a field edit writes into the config only on blur, so the analysis is
// cheaper to settle than a keystroke-rate search.
const RESTART_ANALYSIS_DEBOUNCE_MS = 500;

export interface RestartAnalysis {
  requiredRestarts: string[];
  isAnalyzing: boolean;
  clearRequiredRestarts: () => void;
}

// Why null for a failure: a rejected analysis must not clear the restarts a
// previous successful pass reported, and the caller decides when to stop.
async function collectRequiredRestarts(changedKeys: string[]): Promise<string[] | null> {
  if (changedKeys.length === 0) return [];
  try {
    const result = await analyzeRestartRequirements(changedKeys);
    return result.requiredRestarts;
  } catch (error) {
    console.error('Failed to analyze restarts', error);
    return null;
  }
}

export function useRestartAnalysis(data: EnvFilesData, originalData: EnvFilesData): RestartAnalysis {
  const [requiredRestarts, setRequiredRestarts] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const schedulerRef = useRef<SearchScheduler | null>(null);

  useEffect(() => {
    const scheduler = createSearchScheduler(RESTART_ANALYSIS_DEBOUNCE_MS);
    schedulerRef.current = scheduler;
    return () => scheduler.cancel();
  }, []);

  useEffect(() => {
    const scheduler = schedulerRef.current;
    if (!scheduler) return;
    const changedKeys = computeChangedKeys(data, originalData);

    scheduler.schedule(async (signal) => {
      setIsAnalyzing(true);
      const restarts = await collectRequiredRestarts(changedKeys);
      // Why re-check the signal: a newer edit scheduled while this awaited would
      // otherwise be overwritten by this older result.
      if (signal.aborted) return;
      if (restarts !== null) setRequiredRestarts(restarts);
      setIsAnalyzing(false);
    });
  }, [data, originalData]);

  return {
    requiredRestarts,
    isAnalyzing,
    clearRequiredRestarts: (): void => setRequiredRestarts([]),
  };
}
