// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react';
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

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeEventSource);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

afterEach(() => {
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
});
