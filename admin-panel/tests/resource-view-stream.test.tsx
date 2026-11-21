// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResourceView } from '@/components/resources/ResourceView';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import type { ResourceFrame, ServerStats, StatsSource, WorkerNodeView } from '@/lib/live-frames';
import type { LiveSectionReads } from '@/lib/live/frames';
import en from '@/dictionaries/en.json';
import { encodedFrame } from './stream-frames';

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
      new MessageEvent('message', { data: encodedFrame(frame) }),
    );
  });
}

/**
 * One frame as the stream delivers it, with the read the server states for the frame — and, for the
 * sections it carried forward, that section's own read.
 */
async function deliverAt(frame: ResourceFrame, readAt: string, reads?: LiveSectionReads): Promise<void> {
  await act(async () => {
    FakeEventSource.instances.at(-1)?.onmessage?.(
      new MessageEvent('message', { data: encodedFrame(frame, readAt, reads) }),
    );
  });
}

/**
 * The one cue's wrapper for the value whose text carries this marker.
 *
 * Why by their text and not by position: the cue marks the element it wraps, and the value a test
 * means is the one showing what it read back — the same way a reader finds it on the page.
 */
function cuedElement(marker: string): Element | null {
  const marked = Array.from(document.querySelectorAll('[data-freshness]'));
  return marked.find((candidate) => (candidate.textContent ?? '').includes(marker)) ?? null;
}

/** What the cue states for the section whose rows carry this text. */
function sectionFreshness(marker: string): string | null {
  return cuedElement(marker)?.getAttribute('data-freshness') ?? null;
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

/**
 * The section cue on this page, which is this item's whole point.
 *
 * Why per section and not per frame: the page's one frame accumulates what two poll tracks read at
 * their own cadences, so a single instant dates every carried section by a read that never touched it.
 * The tests below pin the two directions that costs the reader — a section marked stale though nothing
 * had gone wrong, and a section reported current though its own track had stopped refilling it.
 */
describe('resources section freshness', () => {
  const COUNTERS_AT = '2026-10-16T12:00:00.000Z';
  const SUMMARY_AT = '2026-10-16T12:00:05.000Z';
  const LATER_COUNTERS_AT = '2026-10-16T12:00:10.000Z';
  const FAILING_SUMMARY_AT = '2026-10-16T12:00:15.000Z';

  const WORKERS = 'cms-worker-0';
  const SERVICES = 'database';
  const TRAFFIC = 'cms-traffic-log';

  const services = [{ name: 'cms-database', status: 'healthy' }];
  const traffic = [{ id: 1, timestamp: 'now', container: TRAFFIC, rx: '1MB', tx: '2kB' }];

  /** The counters pass: the counters were read, and the other track's sections ride along as they last were. */
  async function countersPass(readAt: string, carried: LiveSectionReads): Promise<void> {
    await deliverAt({ server: stats('host'), workers: [worker()], services, traffic }, readAt, carried);
  }

  it('dates a section the frame carried forward by that section\'s own read', async () => {
    render(surface());

    // The counters pass that opens the page: it read the counters, so the frame's own instant is theirs.
    await deliverAt({ server: stats('host'), workers: [worker()] }, COUNTERS_AT);
    expect(sectionFreshness(WORKERS)).toBe('fresh');

    // The summary pass carries the counters forward. They were read at COUNTERS_AT, and the summary's
    // own, newer read is not what dates them.
    await deliverAt({ server: stats('host'), workers: [worker()], services, traffic }, SUMMARY_AT, { server: COUNTERS_AT, workers: COUNTERS_AT });
    expect(sectionFreshness(WORKERS)).toBe('fresh');
    expect(sectionFreshness(SERVICES)).toBe('fresh');
    expect(sectionFreshness(TRAFFIC)).toBe('fresh');

    // The counters again, carrying the docker-backed sections forward — the same question the other way
    // round. Dating them by this frame's instant instead would have marked them stale the moment the
    // faster track sampled, though nothing about them was behind.
    await countersPass(LATER_COUNTERS_AT, { services: SUMMARY_AT, traffic: SUMMARY_AT });
    expect(sectionFreshness(WORKERS)).toBe('fresh');
    expect(sectionFreshness(SERVICES)).toBe('fresh');
    expect(sectionFreshness(TRAFFIC)).toBe('fresh');
  });

  it('marks the section whose own track did not refill it, and not its sibling read in the same pass', async () => {
    render(surface());
    await deliverAt({ server: stats('host'), workers: [worker()] }, COUNTERS_AT);
    await deliverAt({ server: stats('host'), workers: [worker()], services, traffic }, SUMMARY_AT, { server: COUNTERS_AT, workers: COUNTERS_AT });
    await countersPass(LATER_COUNTERS_AT, { services: SUMMARY_AT, traffic: SUMMARY_AT });

    // The summary runs again with the services probe failing: this one pass refilled the traffic section
    // and left the services section showing what it read before. One frame-level instant cannot tell the
    // two apart, and whichever way it went, one of them was reported wrong.
    await deliverAt({ server: stats('host'), workers: [worker()], traffic }, FAILING_SUMMARY_AT, { server: LATER_COUNTERS_AT, workers: LATER_COUNTERS_AT });

    expect(sectionFreshness(TRAFFIC)).toBe('fresh');
    expect(sectionFreshness(SERVICES)).toBe('stale');
    expect(sectionFreshness(WORKERS)).toBe('fresh');
  });

  it('drops a frame whose section read cannot be dated, rather than dating the section itself', async () => {
    render(surface());
    await deliverAt({ server: stats('host'), workers: [worker()] }, COUNTERS_AT);
    await deliverAt({ server: stats('host'), workers: [worker()], services, traffic }, SUMMARY_AT, { server: COUNTERS_AT, workers: COUNTERS_AT });
    await countersPass(LATER_COUNTERS_AT, { services: SUMMARY_AT, traffic: SUMMARY_AT });
    await deliverAt({ server: stats('host'), workers: [worker()], traffic }, FAILING_SUMMARY_AT, { server: LATER_COUNTERS_AT, workers: LATER_COUNTERS_AT });
    expect(sectionFreshness(SERVICES)).toBe('stale');

    // A frame that carries the section but states a read nobody can parse states nothing at all: the
    // section keeps the read it had and stays marked, instead of being dated by an invented instant.
    await deliverAt({ services, traffic }, '2026-10-16T12:00:20.000Z', { services: 'not an instant' });
    expect(sectionFreshness(SERVICES)).toBe('stale');
  });
});

/**
 * The counters' own figures: the two gauges and the metrics card.
 *
 * Why they ride on the same cue as a row: the counters are dated on the wire like any other section,
 * and these cards are single values rather than rows, so the cue marks each one in place through the
 * one mechanism — the same predicate, the same mark, the same sentence.
 */
describe('resources counter figures', () => {
  const COUNTERS_AT = '2026-10-16T12:00:00.000Z';
  const SUMMARY_AT = '2026-10-16T12:00:05.000Z';

  const CPU = en.resources.cpuUsage;
  const MEMORY = en.resources.memoryUsage;
  const METRICS = en.resources.uptime;

  const services = [{ name: 'cms-database', status: 'healthy' }];

  it('dates the figures by the counters\' own read, not by the frame that carried them forward', async () => {
    render(surface());
    await deliverAt({ server: stats('host'), workers: [worker()] }, COUNTERS_AT);
    expect(sectionFreshness(CPU)).toBe('fresh');
    expect(sectionFreshness(MEMORY)).toBe('fresh');
    expect(sectionFreshness(METRICS)).toBe('fresh');

    // The summary pass runs and carries the counters forward: its newer instant is not what dates
    // them, so no figure is marked by a read that never touched it.
    await deliverAt({ server: stats('host'), workers: [worker()], services }, SUMMARY_AT, { server: COUNTERS_AT, workers: COUNTERS_AT });
    expect(sectionFreshness(CPU)).toBe('fresh');
    expect(sectionFreshness(MEMORY)).toBe('fresh');
    expect(sectionFreshness(METRICS)).toBe('fresh');
  });

  it('marks every figure while the stream that read the counters is gone', async () => {
    render(surface());
    await deliverAt({ server: stats('host'), workers: [worker()] }, COUNTERS_AT);
    expect(sectionFreshness(CPU)).toBe('fresh');

    await act(async () => {
      FakeEventSource.instances.at(-1)?.onerror?.();
    });

    expect(sectionFreshness(CPU)).toBe('stale');
    expect(sectionFreshness(MEMORY)).toBe('stale');
    expect(sectionFreshness(METRICS)).toBe('stale');
    // Why the sentence and not only the mark: the figure is marked by the cue's rule, so its
    // accessible half travels with the figure exactly as it does with a row.
    expect(cuedElement(CPU)?.getAttribute('title')).toContain('reconnecting');
  });

  it('leaves the figures silent until a read dates the counters', async () => {
    render(surface());
    await deliver({ services });

    expect(sectionFreshness(CPU)).toBe('unknown');
    expect(sectionFreshness(MEMORY)).toBe('unknown');
    expect(sectionFreshness(METRICS)).toBe('unknown');
  });
});
