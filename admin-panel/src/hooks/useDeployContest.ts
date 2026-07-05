'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { deployContest, getDeployStatus } from '@/app/actions/services';
import type { DeployStatus } from '@/app/actions/services';

export type DeployPhase = 'idle' | 'deploying' | 'polling' | 'completed' | 'failed' | 'timeout' | 'already_running';

export interface DeployState {
  phase: DeployPhase;
  contestId: number | null;
  operationId: string | null;
  status: DeployStatus | null;
  error: string | null;
  log: string;
  startedAt: string | null;
}

const POLL_INTERVAL_MS = 3000;

const initialState: DeployState = {
  phase: 'idle',
  contestId: null,
  operationId: null,
  status: null,
  error: null,
  log: '',
  startedAt: null,
};

export function useDeployContest() {
  const [state, setState] = useState<DeployState>(initialState);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback((opId: string, cId: number) => {
    stopPolling();

    const doPoll = async () => {
      if (!mountedRef.current) return;
      const result = await getDeployStatus(opId);
      if (!mountedRef.current) return;

      if (result.status === 'completed') {
        stopPolling();
        setState({
          phase: 'completed',
          contestId: cId,
          operationId: opId,
          status: 'completed',
          error: null,
          log: result.log || '',
          startedAt: result.startedAt || null,
        });
      } else if (result.status === 'failed') {
        stopPolling();
        setState({
          phase: 'failed',
          contestId: cId,
          operationId: opId,
          status: 'failed',
          error: result.error || 'Deploy failed',
          log: result.log || '',
          startedAt: result.startedAt || null,
        });
      } else if (result.status === 'timeout') {
        stopPolling();
        setState({
          phase: 'timeout',
          contestId: cId,
          operationId: opId,
          status: 'timeout',
          error: result.error || 'Deploy timed out',
          log: result.log || '',
          startedAt: result.startedAt || null,
        });
      } else if (result.status === 'not_found') {
        stopPolling();
        setState({
          phase: 'failed',
          contestId: cId,
          operationId: opId,
          status: 'not_found',
          error: result.error || 'Operation not found',
          log: '',
          startedAt: null,
        });
      } else if (result.status === 'running') {
        setState((prev) => ({
          ...prev,
          phase: 'polling',
          status: 'running',
          log: result.log || prev.log,
        }));
      }
    };

    intervalRef.current = setInterval(doPoll, POLL_INTERVAL_MS);
    doPoll();
  }, [stopPolling]);

  const deploy = useCallback(async (contestId: number) => {
    stopPolling();
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
        startedAt: null,
      });
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
        startedAt: null,
      });
      return;
    }

    setState({
      phase: 'polling',
      contestId,
      operationId: result.operationId,
      status: 'running',
      error: null,
      log: '',
      startedAt: null,
    });

    startPolling(result.operationId, contestId);
  }, [stopPolling, startPolling]);

  const cancel = useCallback(() => {
    stopPolling();
    setState(initialState);
  }, [stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setState(initialState);
  }, [stopPolling]);

  return { state, deploy, cancel, reset };
}
