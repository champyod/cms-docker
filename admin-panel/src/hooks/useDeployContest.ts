'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { deployContest } from '@/app/actions/services';
import type { DeployStatus } from '@/lib/deploy-percent.shared';
import { useDeployStream } from '@/hooks/useDeployStream';
import { createDeployToast } from '@/lib/deployToast';

export type DeployPhase = 'idle' | 'deploying' | 'polling' | 'completed' | 'failed' | 'timeout' | 'already_running';

export interface DeployState {
  phase: DeployPhase;
  contestId: number | null;
  operationId: string | null;
  status: DeployStatus | null;
  error: string | null;
  log: string;
  percent: number | null;
  startedAt: string | null;
}

const initialState: DeployState = {
  phase: 'idle',
  contestId: null,
  operationId: null,
  status: null,
  error: null,
  log: '',
  percent: null,
  startedAt: null,
};

export function useDeployContest(): { state: DeployState; deploy: (contestId: number) => Promise<void>; cancel: () => void; reset: () => void } {
  const [state, setState] = useState<DeployState>(initialState);
  const toastIdRef = useRef<string | number | null>(null);
  const mountedRef = useRef(true);
  const toastHelper = createDeployToast();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { startStreaming, stopStreaming } = useDeployStream(setState, toastIdRef, mountedRef);

  const dismissProgressToast = useCallback(() => {
    toastHelper.dismiss(toastIdRef);
  }, [toastHelper]);

  const deploy = useCallback(
    async (contestId: number): Promise<void> => {
      stopStreaming();
      dismissProgressToast();
      setState({ ...initialState, phase: 'deploying', contestId });
      const result = await deployContest(contestId);
      if (!mountedRef.current) return;
      if (result.alreadyRunning) {
        setState({ phase: 'already_running', contestId, operationId: null, status: null, error: result.error || 'A deploy is already in progress.', log: '', percent: null, startedAt: null });
        toast.warning('Deploy already running', { description: result.error || 'Another deployment is in progress.' });
        return;
      }
      if (!result.success || !result.operationId) {
        setState({ phase: 'failed', contestId, operationId: null, status: null, error: result.error || 'Failed to start deploy', log: '', percent: null, startedAt: null });
        toast.error('Deploy failed to start', { description: result.error || 'Could not initiate deployment.' });
        return;
      }
      setState({ phase: 'polling', contestId, operationId: result.operationId, status: 'running', error: null, log: '', percent: null, startedAt: null });
      toastIdRef.current = toast.loading(`Deploying contest #${contestId}`, { description: 'Starting deployment...', duration: Infinity });
      startStreaming(result.operationId, contestId);
    },
    [stopStreaming, dismissProgressToast, startStreaming],
  );

  const cancel = useCallback(() => {
    stopStreaming();
    dismissProgressToast();
    setState(initialState);
  }, [stopStreaming, dismissProgressToast]);

  const reset = useCallback(() => {
    stopStreaming();
    dismissProgressToast();
    setState(initialState);
  }, [stopStreaming, dismissProgressToast]);

  return { state, deploy, cancel, reset };
}
