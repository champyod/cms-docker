// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The audit split in docker.ts is only worth anything if the log viewer is actually wired to it.
 * Both halves were wrong once already — a poll that recorded, then a recorded read nothing reached
 * — and neither shows up in a type check. So this renders the real modal against a mocked action
 * module and counts which of the two reads the five-second tick and the refresh button call.
 */

const { fetchContainerLogs, getContainerLogs } = vi.hoisted(() => ({
  fetchContainerLogs: vi.fn(),
  getContainerLogs: vi.fn(),
}));

vi.mock('@/app/actions/docker', () => ({ fetchContainerLogs, getContainerLogs }));

const TICK_MS = 5000;

async function renderViewer(): Promise<ReturnType<typeof render>> {
  const { LogViewerModal } = await import('@/components/containers/LogViewerModal');
  return render(
    <LogViewerModal containerId="abc123456789" containerName="cms-web" onClose={() => undefined} />,
  );
}

async function tick(times = 1): Promise<void> {
  for (let count = 0; count < times; count += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TICK_MS);
    });
  }
}

describe('log viewer audit wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchContainerLogs.mockResolvedValue({ success: true, logs: 'listening on /srv' });
    getContainerLogs.mockResolvedValue({ success: true, logs: 'listening on /srv' });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('polls the unaudited read on every tick and never the recorded one', async () => {
    await renderViewer();
    await tick(3);

    // The mount plus three five-second ticks.
    expect(fetchContainerLogs).toHaveBeenCalledTimes(4);
    expect(getContainerLogs).not.toHaveBeenCalled();
    for (const call of fetchContainerLogs.mock.calls) {
      expect(call[0]).toBe('abc123456789');
    }
  });

  it('records the explicit refresh the operator asked for', async () => {
    await renderViewer();
    await tick();
    const polledBefore = fetchContainerLogs.mock.calls.length;

    // Why act and not waitFor: waitFor polls on timers, and these tests drive the clock
    // themselves, so waiting for it would wait for a tick only this test can give it.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh Logs' }));
    });

    expect(getContainerLogs).toHaveBeenCalledTimes(1);
    expect(getContainerLogs.mock.calls[0][0]).toBe('abc123456789');
    // A refresh is one row, not a new poll: the tick count must not move because of the click.
    expect(fetchContainerLogs.mock.calls.length).toBe(polledBefore);
  });

  it('shows the polled output without waiting for a recorded read', async () => {
    await renderViewer();
    await tick();

    expect(screen.getByText(/listening on \/srv/)).toBeDefined();
    expect(getContainerLogs).not.toHaveBeenCalled();
  });
});
