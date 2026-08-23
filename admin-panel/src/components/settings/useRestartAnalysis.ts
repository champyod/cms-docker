'use client';

import { useEffect, useState } from 'react';
import { analyzeRestartRequirements } from '@/app/actions/services';
import { EnvFilesData, computeChangedKeys } from './envConfigSections';

export interface RestartAnalysis {
  requiredRestarts: string[];
  isAnalyzing: boolean;
  clearRequiredRestarts: () => void;
}

export function useRestartAnalysis(data: EnvFilesData, originalData: EnvFilesData): RestartAnalysis {
  const [requiredRestarts, setRequiredRestarts] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    const checkChanges = async (): Promise<void> => {
      setIsAnalyzing(true);
      const changedKeys = computeChangedKeys(data, originalData);

      if (changedKeys.length > 0) {
        try {
          const result = await analyzeRestartRequirements(changedKeys);
          setRequiredRestarts(result.requiredRestarts);
        } catch (e) {
          console.error('Failed to analyze restarts', e);
        }
      } else {
        setRequiredRestarts([]);
      }
      setIsAnalyzing(false);
    };

    const debounce = setTimeout(checkChanges, 500);
    return () => clearTimeout(debounce);
  }, [data, originalData]);

  return {
    requiredRestarts,
    isAnalyzing,
    clearRequiredRestarts: (): void => setRequiredRestarts([]),
  };
}
