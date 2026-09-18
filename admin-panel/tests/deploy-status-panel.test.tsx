import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeployStatusPanel, LOG_BOTTOM_THRESHOLD_PX, resolveLogFollow } from '@/components/deployments/DeployStatusPanel';
import type { DeployState } from '@/hooks/useDeployContest';

function makeState(overrides: Partial<DeployState>): DeployState {
  return {
    phase: 'idle',
    contestId: 12,
    operationId: 'op-1',
    status: null,
    error: null,
    warning: null,
    log: '',
    percent: null,
    startedAt: null,
    ...overrides,
  };
}

describe('DeployStatusPanel', () => {
  it('renders running state with percent and log tail', () => {
    const html = renderToStaticMarkup(
      <DeployStatusPanel
        state={makeState({ phase: 'polling', status: 'running', percent: 42, log: 'Building image...' })}
        onCancel={() => undefined}
        onReset={() => undefined}
      />
    );
    expect(html).toContain('Running');
    expect(html).toContain('42%');
    expect(html).toContain('Building image...');
    expect(html).toContain('Cancel Deployment');
  });

  it('renders deferred percent as pending when no build output yet', () => {
    const html = renderToStaticMarkup(
      <DeployStatusPanel
        state={makeState({ phase: 'polling', status: 'running', percent: null, log: '' })}
        onCancel={() => undefined}
        onReset={() => undefined}
      />
    );
    expect(html).toContain('Pending build output');
    expect(html).toContain('Waiting for build output...');
  });

  it('renders completed state with 100 percent and dismiss action', () => {
    const html = renderToStaticMarkup(
      <DeployStatusPanel
        state={makeState({ phase: 'completed', status: 'completed', percent: null, log: 'Done' })}
        onCancel={() => undefined}
        onReset={() => undefined}
      />
    );
    expect(html).toContain('Completed');
    expect(html).toContain('100%');
    expect(html).toContain('Dismiss');
    expect(html).not.toContain('Cancel Deployment');
  });

  it('renders failed state with error and warning', () => {
    const html = renderToStaticMarkup(
      <DeployStatusPanel
        state={makeState({
          phase: 'failed',
          status: 'failed',
          error: 'Docker process exited with code 1.',
          warning: 'Rollback to contest #10 failed: EACCES',
          log: 'trace...',
        })}
        onCancel={() => undefined}
        onReset={() => undefined}
      />
    );
    expect(html).toContain('Failed');
    expect(html).toContain('Docker process exited with code 1.');
    expect(html).toContain('Rollback to contest #10 failed: EACCES');
  });

  it('renders timeout state', () => {
    const html = renderToStaticMarkup(
      <DeployStatusPanel
        state={makeState({ phase: 'timeout', status: 'timeout', error: 'Deploy timed out after 15 minutes.' })}
        onCancel={() => undefined}
        onReset={() => undefined}
      />
    );
    expect(html).toContain('Timed Out');
    expect(html).toContain('Deploy timed out after 15 minutes.');
  });

  it('offers the follow toggle over the build log once output exists', () => {
    const html = renderToStaticMarkup(
      <DeployStatusPanel
        state={makeState({ phase: 'polling', status: 'running', log: 'Step 1/3\nBuilding image...' })}
        onCancel={() => undefined}
        onReset={() => undefined}
      />
    );
    expect(html).toContain('Build Log');
    expect(html).toContain('AUTO-SCROLL ON');
    expect(html).toContain('aria-pressed="true"');
  });

  it('omits the follow toggle while there is no output to follow', () => {
    const html = renderToStaticMarkup(
      <DeployStatusPanel
        state={makeState({ phase: 'completed', status: 'completed', log: '' })}
        onCancel={() => undefined}
        onReset={() => undefined}
      />
    );
    expect(html).toContain('No log output available.');
    expect(html).not.toContain('AUTO-SCROLL');
  });
});

describe('resolveLogFollow', () => {
  const overflow: { scrollHeight: number; clientHeight: number } = { scrollHeight: 500, clientHeight: 200 };
  const bottom = overflow.scrollHeight - overflow.clientHeight;

  it('follows new output while the view sits on the newest line', () => {
    expect(resolveLogFollow({ ...overflow, scrollTop: bottom })).toBe(true);
  });

  it('stops following once the operator scrolls up into the history', () => {
    expect(resolveLogFollow({ ...overflow, scrollTop: 120 })).toBe(false);
  });

  it('keeps following within the near-bottom slack', () => {
    expect(resolveLogFollow({ ...overflow, scrollTop: bottom - LOG_BOTTOM_THRESHOLD_PX })).toBe(true);
  });

  it('stops following past the near-bottom slack', () => {
    expect(resolveLogFollow({ ...overflow, scrollTop: bottom - LOG_BOTTOM_THRESHOLD_PX - 1 })).toBe(false);
  });

  it('treats fractional scroll positions on the last line as the bottom', () => {
    expect(resolveLogFollow({ scrollTop: 299.5, scrollHeight: 499.6, clientHeight: 200 })).toBe(true);
  });

  it('follows when the log is shorter than the viewport', () => {
    expect(resolveLogFollow({ scrollTop: 0, scrollHeight: 82, clientHeight: 200 })).toBe(true);
  });
});
