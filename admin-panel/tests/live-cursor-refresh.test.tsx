// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveRefresh } from '@/lib/live/live-refresh';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import en from '@/dictionaries/en.json';

const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: mockRefresh, prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }),
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  close(): void { this.readyState = 2; }
}

function surface(url: string): React.JSX.Element {
  return (
    <DictionaryProvider dict={en}>
      <LiveRefresh url={url} />
    </DictionaryProvider>
  );
}

function deliver(cursor: string | null): Promise<void> {
  return act(async () => {
    FakeEventSource.instances.at(-1)?.onmessage?.(
      new MessageEvent('message', { data: JSON.stringify({ cursor }) }),
    );
  });
}

beforeEach(() => {
  FakeEventSource.instances = [];
  mockRefresh.mockClear();
  vi.stubGlobal('EventSource', FakeEventSource);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * The page-level live path: a server-rendered surface re-renders itself through the router when its
 * cursor moves, and never for a frame the page was just rendered from.
 */
describe('page-level live refresh', () => {
  it('opens the surface route it was given', () => {
    render(surface('/api/teams/stream'));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe('/api/teams/stream');
  });

  it('re-renders only on a cursor the page has not already read', async () => {
    render(surface('/api/teams/stream'));

    // The opening frame is the data the page was rendered from; re-reading here would repeat it.
    await deliver('10');
    expect(mockRefresh).not.toHaveBeenCalled();

    // The heartbeat restates that same cursor, which is no change either.
    await deliver('10');
    expect(mockRefresh).not.toHaveBeenCalled();

    await deliver('11');
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    await deliver('11');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows the connection state beside the surface it refreshes', () => {
    render(surface('/api/ranking/stream'));
    act(() => FakeEventSource.instances[0].onopen?.());
    expect(screen.getByText(en.live.connected)).toBeTruthy();
  });
});
