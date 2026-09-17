import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeployContestContext, useDeployContest, type DeployContestContextValue, type DeployState } from '@/hooks/useDeployContest';

function makeValue(phase: DeployState['phase']): DeployContestContextValue {
  return {
    state: {
      phase, contestId: 12, operationId: 'op-1', status: phase === 'completed' ? 'completed' : 'running',
      error: null, warning: null, log: 'Building...', percent: 42, startedAt: null,
    },
    deploy: vi.fn(async (): Promise<void> => undefined),
    resume: vi.fn(), cancel: vi.fn(), reset: vi.fn(),
  };
}

// Node-only tests can verify context reads, but cannot mount effects or simulate router navigation.
function renderConsumers(value: DeployContestContextValue, observed: DeployContestContextValue[]): string {
  function Consumer({ surface }: { surface: string }): React.JSX.Element {
    const deploy = useDeployContest();
    observed.push(deploy);
    return <output>{surface}:{deploy.state.phase}:{deploy.state.contestId}</output>;
  }
  return renderToStaticMarkup(
    <DeployContestContext.Provider value={value}>
      <Consumer surface="contest-list" />
      <Consumer surface="contest-detail" />
      <Consumer surface="deployments" />
    </DeployContestContext.Provider>,
  );
}

describe('shared deploy context', () => {
  it.each(['polling', 'completed', 'failed', 'timeout', 'idle'] as const)('gives all three consumers the identical %s state and actions', (phase) => {
    const value = makeValue(phase);
    const observed: DeployContestContextValue[] = [];
    const html = renderConsumers(value, observed);
    expect(observed).toHaveLength(3);
    for (const consumer of observed) {
      expect(consumer).toBe(value);
      expect(consumer.state).toBe(value.state);
      expect(consumer.deploy).toBe(value.deploy);
      expect(consumer.cancel).toBe(value.cancel);
      expect(consumer.reset).toBe(value.reset);
    }
    for (const surface of ['contest-list', 'contest-detail', 'deployments']) {
      expect(html).toContain(`${surface}:${phase}:12`);
    }
  });

  it('rejects a consumer outside the shared owner rather than creating local state', () => {
    function Orphan(): React.JSX.Element {
      useDeployContest();
      return <span />;
    }
    expect(() => renderToStaticMarkup(<Orphan />)).toThrow('useDeployContest must be used within a DeployContestProvider');
  });
});
