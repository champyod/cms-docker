'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { deployContest, getActiveDeployOperation } from '@/app/actions/services';
import { DeployContestContext, type DeployState } from '@/hooks/useDeployContest';
import { useDeployStream } from '@/hooks/useDeployStream';
import { createDeployToast } from '@/lib/deployToast';
import { createDeployReattachment } from '@/lib/deploy-reattachment';

const initialState: DeployState = {
  phase: 'idle', contestId: null, operationId: null, status: null,
  error: null, warning: null, log: '', percent: null, startedAt: null,
};
const toastHelper = createDeployToast();

export function DeployContestProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<DeployState>(initialState);
  const stateRef = useRef(state);
  const toastIdRef = useRef<string | number | null>(null);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const [recovery] = useState(() => createDeployReattachment(getActiveDeployOperation));

  // Synchronous state guards also cover two surfaces acting before React's next render.
  const updateState: Dispatch<SetStateAction<DeployState>> = useCallback((next): void => {
    stateRef.current = typeof next === 'function' ? next(stateRef.current) : next;
    setState(stateRef.current);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
      requestRef.current += 1;
      toastHelper.dismiss(toastIdRef);
    };
  }, []);

  const { startStreaming, stopStreaming } = useDeployStream(updateState, toastIdRef, mountedRef);

  const deploy = useCallback(async (contestId: number): Promise<void> => {
    recovery.invalidate();
    if (stateRef.current.phase === 'deploying' || stateRef.current.phase === 'polling') {
      toast.warning('Deploy already running', { description: 'Another deployment is in progress.' });
      return;
    }
    const request = ++requestRef.current;
    stopStreaming();
    toastHelper.dismiss(toastIdRef);
    updateState({ ...initialState, phase: 'deploying', contestId });
    try {
      const result = await deployContest(contestId);
      if (!mountedRef.current || request !== requestRef.current) return;
      if (result.alreadyRunning) {
        updateState({ ...initialState, phase: 'already_running', contestId, error: result.error || 'A deploy is already in progress.' });
        toast.warning('Deploy already running', { description: result.error || 'Another deployment is in progress.' });
        return;
      }
      if (!result.success || !result.operationId) {
        updateState({ ...initialState, phase: 'failed', contestId, error: result.error || 'Failed to start deploy' });
        toast.error('Deploy failed to start', { description: result.error || 'Could not initiate deployment.' });
        return;
      }
      updateState({ ...initialState, phase: 'polling', contestId, operationId: result.operationId, status: 'running' });
      toastIdRef.current = toast.loading(`Deploying contest #${contestId}`, { description: 'Starting deployment...', duration: Infinity });
      startStreaming(result.operationId, contestId);
    } catch (error) {
      if (!mountedRef.current || request !== requestRef.current) return;
      const message = error instanceof Error ? error.message : 'Could not initiate deployment.';
      updateState({ ...initialState, phase: 'failed', contestId, error: message });
      toast.error('Deploy failed to start', { description: message });
    }
  }, [recovery, stopStreaming, startStreaming, updateState]);

  const resume = useCallback((operationId: string, contestId: number): void => {
    recovery.invalidate();
    if (stateRef.current.phase === 'deploying' || stateRef.current.phase === 'polling') return;
    requestRef.current += 1;
    toastHelper.dismiss(toastIdRef);
    updateState({ ...initialState, phase: 'polling', contestId, operationId, status: 'running' });
    toastHelper.showProgress(null, contestId, 'running', toastIdRef);
    startStreaming(operationId, contestId);
  }, [recovery, startStreaming, updateState]);

  useEffect(() => recovery.attach(resume), [recovery, resume]);

  const cancel = useCallback((): void => {
    recovery.invalidate();
    // Ignore a deploy action that resolves after the user has stopped watching.
    requestRef.current += 1;
    stopStreaming();
    toastHelper.dismiss(toastIdRef);
    updateState(initialState);
  }, [recovery, stopStreaming, updateState]);

  return (
    <DeployContestContext.Provider value={{ state, deploy, resume, cancel, reset: cancel }}>
      {children}
    </DeployContestContext.Provider>
  );
}
