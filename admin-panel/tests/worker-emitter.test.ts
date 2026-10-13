import { describe, expect, it } from 'vitest';
import { mapEmitterRowsToNodes } from '@/lib/worker-nodes';

describe('mapEmitterRowsToNodes', () => {
  it('parses the endpoint into host and port', () => {
    const [node] = mapEmitterRowsToNodes(
      [{ shard: 2, endpoint: 'cms-worker-2:26002', state: 'running', health: 'healthy', activity: 'idle', reachable: true }],
      {}
    );
    expect(node).toMatchObject({
      id: 'worker-2',
      shard: 2,
      host: 'cms-worker-2',
      port: 26002,
      endpoint: 'cms-worker-2:26002',
      connection: 'connected',
      health: 'healthy',
      activity: 'idle',
    });
  });

  it('marks a running shard busy by its backlog and flags lagging past the threshold', () => {
    const [busy] = mapEmitterRowsToNodes(
      [{ shard: 3, endpoint: 'cms-worker-3:26003', state: 'running', health: 'healthy', activity: 'working', reachable: true }],
      { 3: 4 }
    );
    expect(busy).toMatchObject({ connection: 'busy', tasks: 4, load: 40, lagging: false });

    const [lagging] = mapEmitterRowsToNodes(
      [{ shard: 3, endpoint: 'cms-worker-3:26003', state: 'running', activity: 'working', reachable: true }],
      { 3: 5 }
    );
    expect(lagging.lagging).toBe(true);
  });

  it('reads an absent-but-reachable remote shard as connected', () => {
    const [node] = mapEmitterRowsToNodes(
      [{ shard: 4, endpoint: '100.75.203.112:26004', state: 'absent', health: 'none', activity: 'unknown', reachable: true }],
      {}
    );
    expect(node).toMatchObject({ connection: 'connected', reachable: true, host: '100.75.203.112', port: 26004 });
  });

  it('keeps absent-unreachable and exited shards disconnected', () => {
    const nodes = mapEmitterRowsToNodes(
      [
        { shard: 5, endpoint: '100.75.203.112:26005', state: 'absent', health: 'none', activity: 'unknown', reachable: false },
        { shard: 0, endpoint: 'cms-worker-0:26000', state: 'exited', health: 'none', activity: 'erroring', reachable: false },
      ],
      {}
    );
    expect(nodes[0].connection).toBe('disconnected');
    expect(nodes[1]).toMatchObject({ connection: 'disconnected', activity: 'erroring' });
  });

  it('reports a row with no signal as unknown rather than down', () => {
    const [node] = mapEmitterRowsToNodes([{ shard: 1, endpoint: 'cms-worker-1:26001' }], {});
    expect(node.connection).toBe('unknown');
  });
});
