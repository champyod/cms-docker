// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveStream } from '@/hooks/useLiveStream';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  close(): void { this.readyState = 2; }
}

function Harness(): React.JSX.Element {
  const { status } = useLiveStream<{ ok: true }>({
    url: '/api/resources/stream',
    onFrame: () => undefined,
  });
  return <span>{status}</span>;
}

function DisabledHarness(): React.JSX.Element {
  const { status } = useLiveStream<{ ok: true }>({
    url: '/api/questions/stream',
    onFrame: () => undefined,
    enabled: false,
  });
  return <span>{status}</span>;
}

/** A channel that exists to reach an operator who is not looking at the panel. */
function FollowHiddenHarness(): React.JSX.Element {
  const { status } = useLiveStream<{ ok: true }>({
    url: '/api/notifications/stream',
    onFrame: () => undefined,
    followHidden: true,
  });
  return <span>{status}</span>;
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeEventSource);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Infrastructure stream route regression', () => {
  it('opens one source and reconnects once after an error', () => {
    render(<Harness />);
    expect(screen.getByText('connecting')).toBeTruthy();
    act(() => FakeEventSource.instances[0].onopen?.());
    expect(screen.getByText('live')).toBeTruthy();
    act(() => FakeEventSource.instances[0].onerror?.());
    expect(screen.getByText('reconnecting')).toBeTruthy();
    act(() => vi.runOnlyPendingTimers());
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1].url).toBe('/api/resources/stream');
  });

  it('opens no source while the channel is not enabled, and reports the pause', () => {
    render(<DisabledHarness />);
    expect(screen.getByText('paused')).toBeTruthy();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('releases the connection when the tab is hidden, for a channel that did not ask to follow it', () => {
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    render(<Harness />);
    expect(FakeEventSource.instances).toHaveLength(1);

    hidden = true;
    act(() => document.dispatchEvent(new Event('visibilitychange')));

    expect(screen.getByText('paused')).toBeTruthy();
    expect(FakeEventSource.instances[0].readyState).toBe(2);
  });

  it('keeps a follow-hidden channel connected while the tab is hidden, and reopens nothing on return', () => {
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    render(<FollowHiddenHarness />);

    // Why it opens at all: the tab mounted while hidden, which is precisely the state this channel
    // exists for, so the connection cannot wait for a show.
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(FakeEventSource.instances[0].readyState).toBe(0);

    hidden = false;
    act(() => document.dispatchEvent(new Event('visibilitychange')));

    // Why no second source: the one that stayed open is still the alert channel, and reopening it
    // would only replay frames this connection already delivered.
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
