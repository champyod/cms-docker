import { describe, expect, it } from 'vitest';
import { mapEmitterRowsToStats } from '@/lib/worker-stats';

describe('mapEmitterRowsToStats', () => {
  it('marks running shards online and busy ones by backlog', () => {
    const stats = mapEmitterRowsToStats(
      [
        { shard: 2, endpoint: 'cms-worker-2:26002', state: 'running', health: 'healthy', activity: 'idle', reachable: true },
        { shard: 3, endpoint: 'cms-worker-3:26003', state: 'running', health: 'healthy', activity: 'working', reachable: true },
      ],
      { 3: 4 }
    );
    expect(stats[0]).toMatchObject({ id: 'worker-2', name: 'cms-worker-2:26002', status: 'online', activity: 'idle', health: 'healthy' });
    expect(stats[1]).toMatchObject({ id: 'worker-3', status: 'busy', tasks: 4, activity: 'working' });
  });

  it('marks absent-but-reachable remote shards online', () => {
    const stats = mapEmitterRowsToStats(
      [{ shard: 4, endpoint: '100.75.203.112:26004', state: 'absent', health: 'none', activity: 'unknown', reachable: true }],
      {}
    );
    expect(stats[0]).toMatchObject({ id: 'worker-4', status: 'online' });
  });

  it('keeps absent-unreachable and exited shards offline', () => {
    const stats = mapEmitterRowsToStats(
      [
        { shard: 5, endpoint: '100.75.203.112:26005', state: 'absent', health: 'none', activity: 'unknown', reachable: false },
        { shard: 0, endpoint: 'cms-worker-0:26000', state: 'exited', health: 'none', activity: 'erroring', reachable: false },
      ],
      {}
    );
    expect(stats[0].status).toBe('offline');
    expect(stats[1]).toMatchObject({ status: 'offline', activity: 'erroring' });
  });
});
