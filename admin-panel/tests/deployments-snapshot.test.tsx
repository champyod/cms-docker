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
  getBoundContestId: vi.fn(),
  getShardContestBindings: vi.fn(),
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
vi.mock('@/app/actions/contests', () => ({
  getAvailableContests: actions.getAvailableContests,
  getBoundContestId: actions.getBoundContestId,
  getShardContestBindings: actions.getShardContestBindings,
}));
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
  actions.getBoundContestId.mockResolvedValue({ success: true, binding: { source: 'registry', contestId: 3, matchedBy: 'declared-shard' } });
  actions.getShardContestBindings.mockResolvedValue({ success: true, bindings: [] });
  actions.getContainerContestId.mockResolvedValue({ success: true, contestId: 1 });
});

describe('useContestDeploymentSnapshot', () => {
  it('clears Loading with the parts it has when every read answers', async () => {
    const { result } = renderSnapshot();

    await waitFor(() => expect(result.current.status.kind).toBe('idle'));
    expect(result.current.failedReads).toEqual([]);
    expect(result.current.containerContestId).toBe(1);
    expect(result.current.boundContestId).toBe(3);
    // The source travels with the id: a registry answer and the deployment default both read as an
    // id, and only this tells them apart on the page.
    expect(result.current.boundContestSource).toBe('registry');
  });

  it('exposes the per-shard registry bindings the card shows instead of one active id', async () => {
    // Two shards on two contests at once: the case the single contests.is_active flag cannot express.
    actions.getShardContestBindings.mockResolvedValue({
      success: true,
      bindings: [
        { id: 1, name: 'web-0', role: 'ContestWebServer', shard: 0, contestId: 9 },
        { id: 2, name: 'proxy-1', role: 'ProxyService', shard: 1, contestId: 7 },
      ],
    });
    const { result } = renderSnapshot();

    await waitFor(() => expect(result.current.status.kind).toBe('idle'));
    expect(result.current.shardBindings).toEqual([
      { id: 1, name: 'web-0', role: 'ContestWebServer', shard: 0, contestId: 9 },
      { id: 2, name: 'proxy-1', role: 'ProxyService', shard: 1, contestId: 7 },
    ]);
    expect(result.current.failedReads).toEqual([]);
  });

  it('shows no binding and names the read when the shard-bindings read fails', async () => {
    actions.getShardContestBindings.mockRejectedValue(new Error('relation "services" does not exist'));
    const { result } = renderSnapshot();

    await waitFor(() => expect(result.current.status.kind).toBe('idle'));
    expect(result.current.shardBindings).toEqual([]);
    // The failure is named, not hidden — the default line beside the empty table still says what runs.
    expect(result.current.failedReads.map((failure) => failure.label)).toContain('shard bindings');
  });

  it('shows no binding when the read answers with a soft failure', async () => {
    actions.getShardContestBindings.mockResolvedValue({ success: false, bindings: [], error: 'permission denied' });
    const { result } = renderSnapshot();

    await waitFor(() => expect(result.current.status.kind).toBe('idle'));
    expect(result.current.shardBindings).toEqual([]);
    expect(result.current.failedReads).toEqual([]);
  });

  it('reports no bound contest while the registry read is the one that failed', async () => {
    actions.getBoundContestId.mockResolvedValue({ success: false, error: 'connection refused' });
    const { result } = renderSnapshot();

    await waitFor(() => expect(result.current.status.kind).toBe('idle'));
    expect(result.current.boundContestId).toBeNull();
    expect(result.current.boundContestSource).toBeNull();
  });

  it('keeps the deployment default as the source when the registry answers with one', async () => {
    actions.getBoundContestId.mockResolvedValue({ success: true, binding: { source: 'deployment', contestId: 1, matchedBy: null } });
    const { result } = renderSnapshot();

    await waitFor(() => expect(result.current.status.kind).toBe('idle'));
    expect(result.current.boundContestId).toBe(1);
    expect(result.current.boundContestSource).toBe('deployment');
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
