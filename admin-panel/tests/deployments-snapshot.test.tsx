// @vitest-environment happy-dom
import React, { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const actions = vi.hoisted(() => ({
  settleDeployOperations: vi.fn(),
  getActiveDeployOperation: vi.fn(),
  readActiveContestId: vi.fn(),
  readConfigTomlValues: vi.fn(),
  updateConfigTomlValues: vi.fn(),
  getAvailableContests: vi.fn(),
  getContainerContestId: vi.fn(),
}));

vi.mock('@/app/actions/deployActions', () => ({
  settleDeployOperations: actions.settleDeployOperations,
  getActiveDeployOperation: actions.getActiveDeployOperation,
}));
vi.mock('@/app/actions/configTomlActions', () => ({
  readActiveContestId: actions.readActiveContestId,
  readConfigTomlValues: actions.readConfigTomlValues,
  updateConfigTomlValues: actions.updateConfigTomlValues,
}));
vi.mock('@/app/actions/contests', () => ({ getAvailableContests: actions.getAvailableContests }));
vi.mock('@/app/actions/docker', () => ({ getContainerContestId: actions.getContainerContestId }));

import { DictionaryContext } from '@/hooks/useDictionary';
import { READ_TIMEOUT_MS } from '@/lib/settled-read';
import { useContestDeploymentSnapshot } from '@/components/deployments/useContestDeploymentSnapshot';
import en from '@/dictionaries/en.json';

afterEach(cleanup);

function wrapper({ children }: { children: ReactNode }): React.JSX.Element {
  return <DictionaryContext.Provider value={en}>{children}</DictionaryContext.Provider>;
}

function renderSnapshot() {
  return renderHook(() => useContestDeploymentSnapshot({ setSaving: vi.fn(), deployPhase: 'idle' }), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  actions.settleDeployOperations.mockResolvedValue(undefined);
  actions.getActiveDeployOperation.mockResolvedValue(null);
  actions.readActiveContestId.mockResolvedValue({ success: true, contestId: 1 });
  actions.readConfigTomlValues.mockResolvedValue({ success: true, values: {} });
  actions.getAvailableContests.mockResolvedValue({ success: true, contests: [] });
  actions.getContainerContestId.mockResolvedValue({ success: true, contestId: 1 });
});

describe('useContestDeploymentSnapshot', () => {
  it('clears Loading with the parts it has when every read answers', async () => {
    const { result } = renderSnapshot();

    await waitFor(() => expect(result.current.status.kind).toBe('idle'));
    expect(result.current.failedReads).toEqual([]);
    expect(result.current.containerContestId).toBe(1);
  });

  it('names the read that failed instead of staying on Loading', async () => {
    actions.getContainerContestId.mockRejectedValue(new Error('EACCES: permission denied'));
    const { result } = renderSnapshot();

    await waitFor(() => expect(result.current.status.kind).toBe('idle'));
    expect(result.current.failedReads).toEqual([
      { label: 'running container', error: 'EACCES: permission denied' },
    ]);
  });

  it('bounds a read that never resolves rather than leaving the surface pending', async () => {
    vi.useFakeTimers();
    actions.getContainerContestId.mockReturnValue(new Promise(() => undefined));
    const { result } = renderSnapshot();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS + 1);
    });

    expect(result.current.status.kind).toBe('idle');
    expect(result.current.failedReads.map((failure) => failure.label)).toContain('running container');
    vi.useRealTimers();
  });
});
