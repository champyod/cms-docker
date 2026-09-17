'use client';

import { useCallback, useMemo, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { parseDeployPercent, type DeployStatus } from '@/lib/deploy-percent.shared';
import { DEPLOY_IDLE_TIMEOUT_MS, DEPLOY_POLL_MS } from '@/lib/constants/deploy';
import { createDeployToast, showDeployResult } from '@/lib/deployToast';
import { useDictionary } from '@/hooks/useDictionary';
import type { DeployState } from '@/hooks/useDeployContest';

interface StreamPayload {
  status: DeployStatus;
  contestId?: number;
  startedAt?: string;
  log: string;
  percent: number | null;
  error?: string;
  warning?: string;
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
  const lastFrameAtRef = useRef<number>(0);
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toasts = useDictionary().toasts.deploy;
  const toastHelper = useMemo(() => createDeployToast(toasts), [toasts]);

  const stopStreaming = useCallback((): void => {
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

  // The authenticated provider owns this hook, so page navigation never runs this cleanup.
  useEffect(() => stopStreaming, [stopStreaming]);

  const startStreaming = useCallback(
    (operationId: string, contestId: number) => {
      stopStreaming();
      lastFrameAtRef.current = Date.now();
      const source = new EventSource(`/api/deploy/status/${operationId}`);
      eventSourceRef.current = source;

      // Why this clock measures frames and not build output: the route sends a status frame at least
      // every DEPLOY_HEARTBEAT_MS while the deploy runs, so reaching this timeout means the connection
      // is gone — never that a build step went quiet. What the panel reports then is that it stopped
      // watching, which is all that stopped: the operation keeps its process and its guard, and the
      // server settles it when that process exits.
      idleTimerRef.current = setInterval(() => {
        if (Date.now() - lastFrameAtRef.current > DEPLOY_IDLE_TIMEOUT_MS) {
          stopStreaming();
          dismissProgressToast();
          if (!mountedRef.current) return;
          // Functional update: the last log line and progress are still the truth about the deploy.
          setState((previous) => ({
            ...previous,
            phase: 'timeout',
            status: 'timeout',
            error: null,
            warning: toasts.watchingStoppedDescription,
          }));
          toast.warning(toasts.watchingStoppedTitle, { description: toasts.watchingStoppedDescription });
        }
      }, DEPLOY_POLL_MS);

      source.onmessage = (event) => {
        if (!mountedRef.current || eventSourceRef.current !== source) return;
        lastFrameAtRef.current = Date.now();
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
          // A 'timeout' is this watch ending, not the deploy failing: it carries no error, and the
          // panel says, in the operator's language, that the deploy continues in the background.
          const released = data.status === 'timeout';
          const phaseMap: Record<string, DeployState['phase']> = { completed: 'completed', failed: 'failed', timeout: 'timeout', not_found: 'failed' };
          setState({
            phase: phaseMap[data.status] ?? 'failed',
            contestId,
            operationId,
            status: data.status,
            error: released ? null : data.error || null,
            warning: released ? toasts.watchingStoppedDescription : data.warning || null,
            log: data.log || '',
            percent: percent ?? (data.status === 'completed' ? 100 : null),
            startedAt: data.startedAt || null,
          });
          showDeployResult(toasts, data.status, contestId, data.error);
        } catch {
          // Ignore malformed frames; the frame clock above still bounds the connection lifetime.
          return;
        }
      };

      source.onerror = () => {
        if (source.readyState === EventSource.CLOSED) stopStreaming();
      };
    },
    [stopStreaming, dismissProgressToast, updateProgressToast, setState, mountedRef, toasts],
  );

  return { startStreaming, stopStreaming };
}
