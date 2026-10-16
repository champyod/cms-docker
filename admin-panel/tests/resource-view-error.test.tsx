// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResourceView } from '@/components/resources/ResourceView';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import type { ResourceFrame } from '@/lib/live-frames';
import en from '@/dictionaries/en.json';
import { encodedFrame } from './stream-frames';

/** Why frames are driven in: the fault reaches the workers card on the stream, never as a prop. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  close(): void { this.readyState = 2; }
}

function surface(): React.JSX.Element {
  return (
    <DictionaryProvider dict={en}>
      <ResourceView />
    </DictionaryProvider>
  );
}

/** Why awaited: the load of this surface ends in a promise, so the frame has to flush a microtask. */
async function deliver(frame: ResourceFrame): Promise<void> {
  await act(async () => {
    FakeEventSource.instances.at(-1)?.onmessage?.(
      new MessageEvent('message', { data: encodedFrame(frame) }),
    );
  });
}

function states(copy: string): boolean {
  return (document.body.textContent ?? '').includes(copy);
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Why the fault and not the empty state: an unreadable fleet configuration arrives as an empty
 * worker list, and this card is the last place that can still say which of the two it was.
 */
describe('resources worker fault', () => {
  it('reports an unreadable configuration instead of an empty fleet', async () => {
    render(surface());
    await deliver({ workers: [], error: 'Worker configuration could not be read: EISDIR: /repo/.env' });

    expect(states('Worker configuration could not be read')).toBe(true);
    expect(states('No worker nodes found')).toBe(false);
  });

  it('returns to the list once a frame carries a readable fleet', async () => {
    render(surface());
    await deliver({ workers: [], error: 'Worker configuration could not be read: EISDIR: /repo/.env' });
    await deliver({ workers: [] });

    expect(states('No worker nodes found')).toBe(true);
    expect(states('Worker configuration could not be read')).toBe(false);
  });
});
