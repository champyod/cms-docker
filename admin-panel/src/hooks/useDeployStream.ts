'use client';

import { useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { parseDeployPercent, type DeployStatus } from '@/lib/deploy-percent.shared';
import { DEPLOY_IDLE_TIMEOUT_MS, DEPLOY_POLL_MS } from '@/lib/constants/deploy';
import { createDeployToast, showDeployResult } from '@/lib/deployToast';
import type { DeployState } from '@/hooks/useDeployContest';

interface StreamPayload {
  status: DeployStatus;
  contestId?: number;
  startedAt?: string;
  log: string;
  percent: number | null;
  error?: string;
  success: boolean;
}

export function useDeployStream(
  setState: React.Dispatch<React.SetStateAction<DeployState>>,
  toastIdRef: React.MutableRefObject<string | number | null>,
  mountedRef: React.MutableRefObject<boolean>,
): {
  startStreaming: (operationId: string, contestId: number) => void;
  stopStreaming: () => void;
} {
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastChangeAtRef = useRef<number>(Date.now());
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastHelper = createDeployToast();

  const stopStreaming = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (idleTimerRef.current !== null) {
      clearInterval(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const dismissProgressToast = useCallback(() => {
    toastHelper.dismiss(toastIdRef);
  }, [toastHelper, toastIdRef]);

  const updateProgressToast = useCallback(
    (percent: number | null, contestId: number, status: string) => {
      toastHelper.showProgress(percent, contestId, status, toastIdRef);
    },
    [toastHelper, toastIdRef],
  );

  useEffect(
    () => () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (idleTimerRef.current !== null) clearInterval(idleTimerRef.current);
    },
    [],
  );

  const startStreaming = useCallback(
    (operationId: string, contestId: number) => {
      stopStreaming();
      lastChangeAtRef.current = Date.now();
      const source = new EventSource(`/api/deploy/status/${operationId}`);
      eventSourceRef.current = source;

      idleTimerRef.current = setInterval(() => {
        if (Date.now() - lastChangeAtRef.current > DEPLOY_IDLE_TIMEOUT_MS) {
          stopStreaming();
          dismissProgressToast();
          if (!mountedRef.current) return;
          setState({ phase: 'timeout', contestId, operationId, status: 'timeout', error: 'Deploy timed out after 5 minutes without log output.', log: '', percent: null, startedAt: null });
          toast.error('Deploy timed out', { description: 'No log output for 5 minutes.' });
        }
      }, DEPLOY_POLL_MS);

      source.onmessage = (event) => {
        if (!mountedRef.current) return;
        lastChangeAtRef.current = Date.now();
        try {
          const data = JSON.parse(event.data) as StreamPayload;
          const percent = data.percent ?? parseDeployPercent(data.log);
          if (data.status === 'running') {
            setState((previous) => ({ ...previous, phase: 'polling', status: 'running', log: data.log || previous.log, percent }));
            updateProgressToast(percent, contestId, 'running');
            return;
          }
          stopStreaming();
          dismissProgressToast();
          const phaseMap: Record<string, DeployState['phase']> = { completed: 'completed', failed: 'failed', timeout: 'timeout', not_found: 'failed' };
          setState({ phase: phaseMap[data.status] ?? 'failed', contestId, operationId, status: data.status, error: data.error || null, log: data.log || '', percent: percent ?? (data.status === 'completed' ? 100 : null), startedAt: data.startedAt || null });
          showDeployResult(data.status, contestId, data.error);
          source.close();
          eventSourceRef.current = null;
          if (idleTimerRef.current !== null) {
            clearInterval(idleTimerRef.current);
            idleTimerRef.current = null;
          }
        } catch {
        }
      };

      source.onerror = () => {
        if (source.readyState === EventSource.CLOSED) stopStreaming();
      };
    },
    [stopStreaming, dismissProgressToast, updateProgressToast, setState, mountedRef],
  );

  return { startStreaming, stopStreaming };
}
