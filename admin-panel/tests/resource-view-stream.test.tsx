// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResourceView } from '@/components/resources/ResourceView';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import type { ResourceFrame, ServerStats, StatsSource, WorkerNodeView } from '@/lib/live-frames';
import en from '@/dictionaries/en.json';

/**
 * Why this drives frames in rather than rendering a prop: the source label and the pending cards are
 * what the page does between two frames of one connection, and that is the state the operator sees.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  close(): void { this.readyState = 2; }
}

function stats(source: ServerStats['source'], networkSource?: StatsSource): ServerStats {
  const network = networkSource ?? source;
  return { cpu: 12, memory: 40, uptime: '3d', network: { rx: 1, tx: 2, source: network }, loadAvg: ['0.10', '0.20', '0.30'], source };
}

function worker(): WorkerNodeView {
  return {
    id: 'worker-0',
    host: 'cms-worker-0',
    port: 26000,
    shard: 0,
    endpoint: 'cms-worker-0:26000',
    connection: 'connected',
    state: 'running',
    health: 'healthy',
    activity: 'idle',
    reachable: true,
    tasks: 0,
    load: 0,
    lagging: false,
    contest: null,
    uptime: '',
    restarts: 0,
    lastLog: '',
  };
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
      new MessageEvent('message', { data: JSON.stringify(frame) }),
    );
  });
}

function states(copy: string): boolean {
  return (document.body.textContent ?? '').includes(copy);
}

// Why count instead of includes: one label may legitimately appear on more than one figure.
function count(copy: string): number {
  return (document.body.textContent ?? '').split(copy).length - 1;
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

describe('resources surface source label', () => {
  it('claims neither source while the page is still waiting for a sample', () => {
    render(surface());

    expect(states(en.resources.containerSource)).toBe(false);
    expect(states(en.resources.hostSource)).toBe(false);
  });

  it('claims no source from a frame that carries no counters', async () => {
    render(surface());
    await deliver({ workers: [worker()] });

    // The worker section arrived, so the load is over — and the counters' origin is still unknown.
    expect(states(en.resources.loading)).toBe(false);
    expect(states(en.resources.containerSource)).toBe(false);
    expect(states(en.resources.hostSource)).toBe(false);
  });

  it('names the source the counters actually came from', async () => {
    render(surface());
    await deliver({ workers: [worker()], server: stats('container') });
    expect(states(en.resources.containerSource)).toBe(true);
    expect(states(en.resources.hostSource)).toBe(false);

    await deliver({ server: stats('host') });
    expect(states(en.resources.hostSource)).toBe(true);
    expect(states(en.resources.containerSource)).toBe(false);
  });

  it('labels the network figures with their own source, apart from the host figures', async () => {
    render(surface());
    // The CPU and RAM gauges carry the host label; the network figures are a container reading underneath.
    await deliver({ workers: [worker()], server: stats('host', 'container') });

    expect(count(en.resources.hostSource)).toBe(2);
    expect(count(en.resources.containerSource)).toBe(1);
  });
});

describe('resources surface pending sections', () => {
  it('keeps the docker-backed cards pending instead of reporting them empty', async () => {
    render(surface());
    await deliver({ workers: [worker()], server: stats('host') });

    expect(states('No services found')).toBe(false);
    expect(states('No traffic data available')).toBe(false);

    await deliver({
      services: [{ name: 'cms-database', status: 'healthy' }],
      traffic: [{ id: 0, timestamp: 'now', container: 'cms-database', rx: '1MB', tx: '2kB' }],
    });
    expect(states('cms-database')).toBe(true);
    expect(states('No traffic data available')).toBe(false);

    // An empty list the frame actually carried is a reading, and the card may say so.
    await deliver({ services: [] });
    expect(states('No services found')).toBe(true);
  });
});
