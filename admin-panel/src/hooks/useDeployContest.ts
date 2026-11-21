'use client';

import { createContext, useContext } from 'react';
import type { DeployStatus } from '@/lib/deploy-percent.shared';

export type DeployPhase = 'idle' | 'deploying' | 'polling' | 'completed' | 'failed' | 'timeout' | 'already_running';

export interface DeployState {
  phase: DeployPhase;
  contestId: number | null;
  operationId: string | null;
  status: DeployStatus | null;
  error: string | null;
  warning: string | null;
  log: string;
  percent: number | null;
  startedAt: string | null;
}

export interface DeployContestContextValue {
  state: DeployState;
  deploy: (contestId: number) => Promise<void>;
  resume: (operationId: string, contestId: number) => void;
  cancel: () => void;
  reset: () => void;
}

export const DeployContestContext = createContext<DeployContestContextValue | undefined>(undefined);

export function useDeployContest(): DeployContestContextValue {
  const context = useContext(DeployContestContext);
  if (!context) {
    throw new Error('useDeployContest must be used within a DeployContestProvider');
  }
  return context;
}
