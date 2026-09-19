import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONTAINERS_POLL_MS,
  LIVE_HEARTBEAT_MS,
  LIVE_IDLE_TIMEOUT_MS,
  RESOURCE_SERVER_POLL_MS,
} from '@/lib/constants/live-stream';
import { GET as resourcesStream } from '@/app/api/resources/stream/route';
import { GET as containersStream } from '@/app/api/containers/stream/route';
import type { ContainersFrame, ResourceFrame, ServerStats, WorkerStat } from '@/lib/live-frames';

/**
 * The panel's push channels: what the browser receives, and what the server does not send.
 *
 * Why the clocks are faked: these routes are clocks. Advancing them by hand lets a 15-second heartbeat
 * be observed in milliseconds, and lets a deliberately slow probe be made slower than its own
 * interval — which is the only way the overlap guard can be shown to work.
 */
const mocks = vi.hoisted(() => ({
  verifyApiPermission: vi.fn(),
  getFreshPermissions: vi.fn(),
  hasEffectivePermission: vi.fn(),
  collectServerStats: vi.fn(),
  collectWorkerStats: vi.fn(),
  collectCoreServicesStatus: vi.fn(),
  collectNetworkTrafficLogs: vi.fn(),
  collectContainers: vi.fn(),
  collectContainerRestartCount: vi.fn(),
  readContainerRestartConfig: vi.fn(),
}));

vi.mock('@/lib/api-utils', () => ({ verifyApiPermission: mocks.verifyApiPermission }));
vi.mock('@/lib/permissions', () => ({ getFreshPermissions: mocks.getFreshPermissions }));
vi.mock('@/lib/permission-engine', () => ({ hasEffectivePermission: mocks.hasEffectivePermission }));
vi.mock('@/lib/server-stats', () => ({ collectServerStats: mocks.collectServerStats }));
vi.mock('@/lib/worker-stats', () => ({ collectWorkerStats: mocks.collectWorkerStats }));
vi.mock('@/lib/container-probes', () => ({
  collectCoreServicesStatus: mocks.collectCoreServicesStatus,
  collectNetworkTrafficLogs: mocks.collectNetworkTrafficLogs,
  collectContainers: mocks.collectContainers,
  collectContainerRestartCount: mocks.collectContainerRestartCount,
}));
vi.mock('@/lib/container-restart-store', () => ({ readContainerRestartConfig: mocks.readContainerRestartConfig }));

// Why captured before the fake clock is installed: the tests need one timer that measures real time
// while the streams' own timers are driven by hand.
const realSetTimeout = globalThis.setTimeout.bind(globalThis);

const EVERY_PERMISSION = ['all:all', 'service:read', 'container:read', 'container:list', 'resource:list'];
const STATS_ONLY = ['resource:list', 'all:all'];

function stats(cpu: number): ServerStats {
  return { cpu, memory: 40, uptime: '3d', network: { rx: 100, tx: 200 }, loadAvg: ['0.10', '0.20', '0.30'], source: 'host' };
}

function worker(): WorkerStat {
  return { id: 'worker-0', name: 'w0', status: 'online', tasks: 0, load: 0, activity: 'idle', health: 'healthy' };
}

function traffic(rx: string): { id: number; timestamp: string; container: string; rx: string; tx: string }[] {
  return [{ id: 0, timestamp: 'stamped-at-collection', container: 'cms-database', rx, tx: '2kB' }];
}

async function openResources(limit = '20'): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await resourcesStream(new Request(`http://panel.local/api/resources/stream?trafficLimit=${limit}`));
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  return (response.body as ReadableStream<Uint8Array>).getReader();
}

async function openContainers(): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await containersStream();
  expect(response.status).toBe(200);
  return (response.body as ReadableStream<Uint8Array>).getReader();
}

/**
 * Reads the frames a stream delivered, and returns once it has been quiet for a real moment.
 *
 * Why the pending read is remembered per stream: a read abandoned when the quiet timer wins would
 * swallow the next frame, and "no frame was sent" is exactly what several of these tests assert.
 */
const pendingReads = new WeakMap<
  ReadableStreamDefaultReader<Uint8Array>,
  Promise<ReadableStreamReadResult<Uint8Array>>
>();

async function framesWithin(reader: ReadableStreamDefaultReader<Uint8Array>, quietMs = 30): Promise<string[]> {
  const frames: string[] = [];
  for (;;) {
    let pending = pendingReads.get(reader);
    if (pending === undefined) {
      pending = reader.read();
      pendingReads.set(reader, pending);
    }
    const quiet = new Promise<'quiet'>((resolve) => { realSetTimeout(() => resolve('quiet'), quietMs); });
    const next = await Promise.race([pending, quiet]);
    if (next === 'quiet') return frames;
    pendingReads.delete(reader);
    if (next.done) return frames;
    frames.push(new TextDecoder().decode(next.value));
  }
}

function toFrame<TFrame>(raw: string): TFrame {
  return JSON.parse(raw.replace(/^data: /, '').trim()) as TFrame;
}

/** Every frame must be dispatcheable: an SSE comment would never reach the client's onmessage. */
function expectDataFrames(frames: string[]): string[] {
  for (const frame of frames) expect(frame.startsWith('data: ')).toBe(true);
  return frames;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  mocks.verifyApiPermission.mockReset();
  mocks.verifyApiPermission.mockResolvedValue({ authorized: true, session: { userId: '1' } });
  mocks.getFreshPermissions.mockReset();
  mocks.getFreshPermissions.mockResolvedValue(new Set(EVERY_PERMISSION));
  mocks.hasEffectivePermission.mockReset();
  mocks.hasEffectivePermission.mockImplementation((effective: ReadonlySet<string>, key: string) => effective.has(key));
  mocks.collectServerStats.mockReset();
  mocks.collectServerStats.mockResolvedValue(stats(21));
  mocks.collectWorkerStats.mockReset();
  mocks.collectWorkerStats.mockResolvedValue([worker()]);
  mocks.collectCoreServicesStatus.mockReset();
  mocks.collectCoreServicesStatus.mockResolvedValue({ success: true, services: [{ name: 'cms-database', status: 'healthy' }] });
  mocks.collectNetworkTrafficLogs.mockReset();
  mocks.collectNetworkTrafficLogs.mockResolvedValue({ success: true, logs: traffic('1MB') });
  mocks.collectContainers.mockReset();
  mocks.collectContainers.mockResolvedValue([
    { id: 'abc123', name: 'cms-database', image: 'postgres', status: 'Up 2 hours', state: 'running', created: 'now', isCmsContainer: true },
  ]);
  mocks.collectContainerRestartCount.mockReset();
  mocks.collectContainerRestartCount.mockResolvedValue(2);
  mocks.readContainerRestartConfig.mockReset();
  mocks.readContainerRestartConfig.mockResolvedValue({
    abc123: { autoRestart: false, maxRestarts: 5, currentRestarts: 0, discordNotifications: true },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('resources stream', () => {
  it('opens with one frame carrying every section, and never as an SSE comment', async () => {
    const reader = await openResources();
    await vi.advanceTimersByTimeAsync(0);

    const frames = expectDataFrames(await framesWithin(reader));
    expect(frames).toHaveLength(1);
    const frame = toFrame<ResourceFrame>(frames[0]);
    expect(frame.server?.cpu).toBe(21);
    expect(frame.workers).toHaveLength(1);
    expect(frame.services).toEqual([{ name: 'cms-database', status: 'healthy' }]);
    expect(frame.traffic).toHaveLength(1);
    // The page size travels with the connection, so the table's selector has no request of its own.
    expect(mocks.collectNetworkTrafficLogs).toHaveBeenCalledWith(20);
  });

  it('sends nothing while the data stands still, then a heartbeat frame the client can act on', async () => {
    const reader = await openResources();
    await vi.advanceTimersByTimeAsync(0);
    await framesWithin(reader);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.collectServerStats.mock.calls.length).toBeGreaterThan(9);
    expect(await framesWithin(reader)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(LIVE_HEARTBEAT_MS);
    const heartbeat = expectDataFrames(await framesWithin(reader));
    expect(heartbeat).toHaveLength(1);
    expect(toFrame<ResourceFrame>(heartbeat[0])).toMatchObject({ server: { cpu: 21 } });

    // The client's watchdog must not fire on a healthy connection: the heartbeat lands well inside the
    // window it measures, and every frame — heartbeat included — is a full snapshot it can render.
    expect(LIVE_HEARTBEAT_MS).toBeLessThan(LIVE_IDLE_TIMEOUT_MS);
  });

  it('pushes again as soon as a reading changes', async () => {
    const reader = await openResources();
    await vi.advanceTimersByTimeAsync(0);
    await framesWithin(reader);

    mocks.collectServerStats.mockResolvedValue(stats(88));
    await vi.advanceTimersByTimeAsync(RESOURCE_SERVER_POLL_MS);
    const frames = expectDataFrames(await framesWithin(reader));
    expect(frames).toHaveLength(1);
    expect(toFrame<ResourceFrame>(frames[0]).server?.cpu).toBe(88);
  });

  it('keeps the stream open when one probe fails, and leaves that section out of the frame', async () => {
    const reader = await openResources();
    await vi.advanceTimersByTimeAsync(0);
    await framesWithin(reader);

    mocks.collectNetworkTrafficLogs.mockResolvedValue({ success: false, logs: [], error: 'docker is not running' });
    mocks.collectServerStats.mockResolvedValue(stats(55));
    await vi.advanceTimersByTimeAsync(5_000);
    const frames = expectDataFrames(await framesWithin(reader)).map(toFrame<ResourceFrame>);
    const afterFailure = frames[frames.length - 1];

    // The counters still move and the traffic rows are gone rather than empty, which is what lets the
    // table keep the rows it was already showing instead of dropping to "no traffic data".
    expect(afterFailure.server?.cpu).toBe(55);
    expect(afterFailure.traffic).toBeUndefined();
    expect(afterFailure.services).toHaveLength(1);

    mocks.collectNetworkTrafficLogs.mockResolvedValue({ success: true, logs: traffic('9MB') });
    await vi.advanceTimersByTimeAsync(5_000);
    const recovered = (await framesWithin(reader)).map(toFrame<ResourceFrame>).pop();
    expect(recovered?.traffic?.[0].rx).toBe('9MB');
  });

  it('does not read a section the viewer may not read', async () => {
    mocks.getFreshPermissions.mockResolvedValue(new Set(STATS_ONLY));
    const reader = await openResources();
    await vi.advanceTimersByTimeAsync(0);

    const frame = toFrame<ResourceFrame>((await framesWithin(reader))[0]);
    expect(frame.server?.cpu).toBe(21);
    expect(frame.services).toBeUndefined();
    expect(frame.traffic).toBeUndefined();
    expect(mocks.collectCoreServicesStatus).not.toHaveBeenCalled();
    expect(mocks.collectNetworkTrafficLogs).not.toHaveBeenCalled();
  });

  it('never runs two samples of the same section at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mocks.collectServerStats.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Slower than the interval that asks for it, which is what a busy host does to this probe.
      await new Promise((resolve) => setTimeout(resolve, RESOURCE_SERVER_POLL_MS * 3));
      inFlight -= 1;
      return stats(33);
    });

    const reader = await openResources();
    await vi.advanceTimersByTimeAsync(RESOURCE_SERVER_POLL_MS * 10);

    expect(maxInFlight).toBe(1);
    expect(mocks.collectServerStats.mock.calls.length).toBeGreaterThan(1);
    await framesWithin(reader);
  });

  it('refuses the connection without the page permission', async () => {
    mocks.verifyApiPermission.mockResolvedValue({ authorized: false, response: new Response('nope', { status: 403 }) });
    const response = await resourcesStream(new Request('http://panel.local/api/resources/stream'));
    expect(response.status).toBe(403);
    expect(mocks.collectServerStats).not.toHaveBeenCalled();
  });
});

describe('containers stream', () => {
  it('opens with the list, its restart counts and its config', async () => {
    const reader = await openContainers();
    await vi.advanceTimersByTimeAsync(0);

    const frames = expectDataFrames(await framesWithin(reader));
    expect(frames).toHaveLength(1);
    const frame = toFrame<ContainersFrame>(frames[0]);
    expect(frame.containers).toHaveLength(1);
    expect(frame.restartCounts).toEqual({ abc123: 2 });
    expect(frame.config?.abc123.autoRestart).toBe(false);
  });

  it('sends a frame only when the snapshot changes', async () => {
    const reader = await openContainers();
    await vi.advanceTimersByTimeAsync(0);
    await framesWithin(reader);

    await vi.advanceTimersByTimeAsync(CONTAINERS_POLL_MS);
    expect(await framesWithin(reader)).toHaveLength(0);

    mocks.collectContainerRestartCount.mockResolvedValue(3);
    await vi.advanceTimersByTimeAsync(CONTAINERS_POLL_MS);
    const frames = expectDataFrames(await framesWithin(reader)).map((raw) => toFrame<ContainersFrame>(raw));
    // The heartbeat at 15s restates the snapshot as it still was, then the poll at 20s carries the
    // change — which is what "a frame only when something changed, plus a heartbeat" looks like.
    expect(frames).toHaveLength(2);
    expect(frames[0].restartCounts).toEqual({ abc123: 2 });
    expect(frames[1].restartCounts).toEqual({ abc123: 3 });
  });

  it('skips a pass that would overlap the one docker is already answering', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mocks.collectContainers.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, CONTAINERS_POLL_MS * 3));
      inFlight -= 1;
      return [];
    });

    const reader = await openContainers();
    await vi.advanceTimersByTimeAsync(CONTAINERS_POLL_MS * 10);

    expect(maxInFlight).toBe(1);
    expect(mocks.collectContainers.mock.calls.length).toBeGreaterThan(1);
    await framesWithin(reader);
  });

  it('sends no container details to a viewer who may not read them', async () => {
    mocks.getFreshPermissions.mockResolvedValue(new Set(['container:list']));
    const reader = await openContainers();
    await vi.advanceTimersByTimeAsync(0);

    const frame = toFrame<ContainersFrame>((await framesWithin(reader))[0]);
    expect(frame.containers).toBeUndefined();
    expect(mocks.collectContainers).not.toHaveBeenCalled();
  });

  it('refuses the connection without the page permission', async () => {
    mocks.verifyApiPermission.mockResolvedValue({ authorized: false, response: new Response('nope', { status: 403 }) });
    const response = await containersStream();
    expect(response.status).toBe(403);
    expect(mocks.collectContainers).not.toHaveBeenCalled();
  });
});
