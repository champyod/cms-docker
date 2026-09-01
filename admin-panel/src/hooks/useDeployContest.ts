'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { deployContest } from '@/app/actions/services';
import { parseDeployPercent, type DeployStatus } from '@/lib/deploy-operations';

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

const DEPLOY_IDLE_TIMEOUT_MS = 60_000;

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

function parsePercentFromLog(log: string): number | null {
  return parseDeployPercent(log);
}

function buildProgressBar(percent: number | null): string {
  if (percent === null) return '';
  return `Progress ${percent}% pulling`;
}

export function useDeployContest() {
  const [state, setState] = useState<DeployState>(initialState);
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastChangeAtRef = useRef<number>(Date.now());
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastIdRef = useRef<string | number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (idleTimerRef.current !== null) {
        clearInterval(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, []);

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
    if (toastIdRef.current !== null) {
      toast.dismiss(toastIdRef.current);
      toastIdRef.current = null;
    }
  }, []);

  const updateProgressToast = useCallback((percent: number | null, contestId: number, status: string) => {
    const message = percent !== null ? `Deploying contest #${contestId} — ${percent}% pulling` : `Deploying contest #${contestId} — ${status}`;
    const description = percent !== null ? buildProgressBar(percent) : 'Waiting for build output...';
    if (toastIdRef.current === null) {
      toastIdRef.current = toast.loading(message, {
        description,
        duration: Infinity,
      });
    } else {
      // Update existing toast with new progress; sonner allows reusing same identifier
      toast.loading(message, {
        id: toastIdRef.current,
        description,
        duration: Infinity,
      });
    }
  }, []);

  const startStreaming = useCallback(
    (operationId: string, contestId: number) => {
      stopStreaming();
      lastChangeAtRef.current = Date.now();

      const source = new EventSource(`/api/deploy/status/${operationId}`);
      eventSourceRef.current = source;

      // Why idle 60 seconds from last message: docker pull may run for minutes on slow links but always emits log chunks; only silence proves the process is hung, so we track lastChangeAt and timeout only on silence.
      idleTimerRef.current = setInterval(() => {
        const idleMs = Date.now() - lastChangeAtRef.current;
        if (idleMs > DEPLOY_IDLE_TIMEOUT_MS) {
          stopStreaming();
          dismissProgressToast();
          if (!mountedRef.current) return;
          setState({
            phase: 'timeout',
            contestId,
            operationId,
            status: 'timeout',
            error: 'Deploy timed out after 60 seconds without log output.',
            log: '',
            percent: null,
            startedAt: null,
          });
          toast.error('Deploy timed out', {
            description: 'No log output for 60 seconds. The deployment may be hung.',
          });
        }
      }, 1000);

      source.onmessage = (event) => {
        if (!mountedRef.current) return;
        lastChangeAtRef.current = Date.now();
        try {
          const data = JSON.parse(event.data) as {
            status: DeployStatus;
            contestId?: number;
            startedAt?: string;
            log: string;
            percent: number | null;
            error?: string;
            success: boolean;
          };

          const percent = data.percent ?? parsePercentFromLog(data.log);

          if (data.status === 'completed') {
            stopStreaming();
            dismissProgressToast();
            setState({
              phase: 'completed',
              contestId,
              operationId,
              status: 'completed',
              error: null,
              log: data.log || '',
              percent: percent ?? 100,
              startedAt: data.startedAt || null,
            });
            toast.success('Contest deployed', {
              description: `Contest #${contestId} is now active.`,
            });
            source.close();
            eventSourceRef.current = null;
            if (idleTimerRef.current !== null) {
              clearInterval(idleTimerRef.current);
              idleTimerRef.current = null;
            }
          } else if (data.status === 'failed') {
            stopStreaming();
            dismissProgressToast();
            setState({
              phase: 'failed',
              contestId,
              operationId,
              status: 'failed',
              error: data.error || 'Deploy failed',
              log: data.log || '',
              percent,
              startedAt: data.startedAt || null,
            });
            toast.error('Deploy failed', { description: data.error || 'Deployment did not complete.' });
            source.close();
            eventSourceRef.current = null;
            if (idleTimerRef.current !== null) {
              clearInterval(idleTimerRef.current);
              idleTimerRef.current = null;
            }
          } else if (data.status === 'timeout') {
            stopStreaming();
            dismissProgressToast();
            setState({
              phase: 'timeout',
              contestId,
              operationId,
              status: 'timeout',
              error: data.error || 'Deploy timed out',
              log: data.log || '',
              percent,
              startedAt: data.startedAt || null,
            });
            toast.error('Deploy timed out', { description: data.error || 'No output for 60 seconds.' });
            source.close();
            eventSourceRef.current = null;
            if (idleTimerRef.current !== null) {
              clearInterval(idleTimerRef.current);
              idleTimerRef.current = null;
            }
          } else if (data.status === 'not_found') {
            stopStreaming();
            dismissProgressToast();
            setState({
              phase: 'failed',
              contestId,
              operationId,
              status: 'not_found',
              error: data.error || 'Operation not found',
              log: '',
              percent: null,
              startedAt: null,
            });
            toast.error('Deploy not found', { description: data.error || 'Operation identifier is unknown.' });
            source.close();
            eventSourceRef.current = null;
            if (idleTimerRef.current !== null) {
              clearInterval(idleTimerRef.current);
              idleTimerRef.current = null;
            }
          } else if (data.status === 'running') {
            setState((previous) => ({
              ...previous,
              phase: 'polling',
              status: 'running',
              log: data.log || previous.log,
              percent,
            }));
            updateProgressToast(percent, contestId, 'running');
          }
        } catch {
          // Ignore malformed event payload
        }
      };

      source.onerror = () => {
        // EventSource will auto-retry; only treat as fatal if already closed
        if (source.readyState === EventSource.CLOSED) {
          stopStreaming();
        }
      };
    },
    [stopStreaming, dismissProgressToast, updateProgressToast]
  );

  const deploy = useCallback(
    async (contestId: number) => {
      stopStreaming();
      dismissProgressToast();
      setState({ ...initialState, phase: 'deploying', contestId });

      const result = await deployContest(contestId);
      if (!mountedRef.current) return;

      if (result.alreadyRunning) {
        setState({
          phase: 'already_running',
          contestId,
          operationId: null,
          status: null,
          error: result.error || 'A deploy is already in progress.',
          log: '',
          percent: null,
          startedAt: null,
        });
        toast.warning('Deploy already running', { description: result.error || 'Another deployment is in progress.' });
        return;
      }

      if (!result.success || !result.operationId) {
        setState({
          phase: 'failed',
          contestId,
          operationId: null,
          status: null,
          error: result.error || 'Failed to start deploy',
          log: '',
          percent: null,
          startedAt: null,
        });
        toast.error('Deploy failed to start', { description: result.error || 'Could not initiate deployment.' });
        return;
      }

      setState({
        phase: 'polling',
        contestId,
        operationId: result.operationId,
        status: 'running',
        error: null,
        log: '',
        percent: null,
        startedAt: null,
      });

      toastIdRef.current = toast.loading(`Deploying contest #${contestId}`, {
        description: 'Starting deployment...',
        duration: Infinity,
      });

      startStreaming(result.operationId, contestId);
    },
    [stopStreaming, dismissProgressToast, startStreaming]
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
