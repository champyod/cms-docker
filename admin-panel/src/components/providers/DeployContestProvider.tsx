'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { deployContest, fetchActiveDeployOperation } from '@/app/actions/deployActions';
import { DeployContestContext, type DeployState } from '@/hooks/useDeployContest';
import { useDeployStream } from '@/hooks/useDeployStream';
import { useDictionary } from '@/hooks/useDictionary';
import { createDeployToast } from '@/lib/deployToast';
import { createDeployReattachment } from '@/lib/deploy-reattachment';
import { interpolate } from '@/lib/interpolate';

const initialState: DeployState = {
  phase: 'idle', contestId: null, operationId: null, status: null,
  error: null, warning: null, log: '', percent: null, startedAt: null,
};

export function DeployContestProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<DeployState>(initialState);
  const stateRef = useRef(state);
  const toastIdRef = useRef<string | number | null>(null);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  // Why the unaudited lookup: this discovery repeats for as long as the tab is open, so an
  // audited read here would fill the log with a panel doing nothing.
  const [recovery] = useState(() => createDeployReattachment(fetchActiveDeployOperation));
  const toasts = useDictionary().toasts.deploy;
  const toastHelper = useMemo(() => createDeployToast(toasts), [toasts]);

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
  }, [toastHelper]);

  const { startStreaming, stopStreaming } = useDeployStream(updateState, toastIdRef, mountedRef);

  const deploy = useCallback(async (contestId: number): Promise<void> => {
    recovery.invalidate();
    if (stateRef.current.phase === 'deploying' || stateRef.current.phase === 'polling') {
      toast.warning(toasts.alreadyRunningTitle, { description: toasts.alreadyRunningDescription });
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
        toast.warning(toasts.alreadyRunningTitle, { description: result.error || toasts.alreadyRunningDescription });
        return;
      }
      if (!result.success || !result.operationId) {
        updateState({ ...initialState, phase: 'failed', contestId, error: result.error || 'Failed to start deploy' });
        toast.error(toasts.startFailedTitle, { description: result.error || toasts.startFailedDescription });
        return;
      }
      updateState({ ...initialState, phase: 'polling', contestId, operationId: result.operationId, status: 'running' });
      // This panel watches it from here, so discovery must not hand the same operation back later.
      recovery.invalidate(result.operationId);
      toastIdRef.current = toast.loading(interpolate(toasts.startedTitle, { contestId }), { description: toasts.startingDescription, duration: Infinity });
      startStreaming(result.operationId, contestId);
    } catch (error) {
      if (!mountedRef.current || request !== requestRef.current) return;
      const message = error instanceof Error ? error.message : toasts.startFailedDescription;
      updateState({ ...initialState, phase: 'failed', contestId, error: message });
      toast.error(toasts.startFailedTitle, { description: message });
    }
  }, [recovery, stopStreaming, startStreaming, updateState, toastHelper, toasts]);

  const resume = useCallback((operationId: string, contestId: number): void => {
    recovery.invalidate(operationId);
    if (stateRef.current.phase === 'deploying' || stateRef.current.phase === 'polling') return;
    requestRef.current += 1;
    toastHelper.dismiss(toastIdRef);
    updateState({ ...initialState, phase: 'polling', contestId, operationId, status: 'running' });
    toastHelper.showProgress(null, contestId, 'running', toastIdRef);
    startStreaming(operationId, contestId);
  }, [recovery, startStreaming, updateState, toastHelper]);

  useEffect(() => recovery.attach(resume), [recovery, resume]);

  const cancel = useCallback((): void => {
    // Dismissing is about this panel, not about the deploy: the operation keeps running and the
    // server settles it when its process exits, so discovery must not resurface it here.
    recovery.invalidate(stateRef.current.operationId);
    // Ignore a deploy action that resolves after the user has stopped watching.
    requestRef.current += 1;
    stopStreaming();
    toastHelper.dismiss(toastIdRef);
    updateState(initialState);
  }, [recovery, stopStreaming, updateState, toastHelper]);

  return (
    <DeployContestContext.Provider value={{ state, deploy, resume, cancel, reset: cancel }}>
      {children}
    </DeployContestContext.Provider>
  );
}
