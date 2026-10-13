import { beforeEach, describe, expect, it, vi } from 'vitest';

// Why fs is faked: which file the collector reads decides the source it claims, and that choice cannot be exercised against this machine's /proc.
const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  exists: new Set<string>(),
}));

vi.mock('fs', () => ({
  default: {
    readFileSync: (path: string): string => {
      const content = mocks.files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    existsSync: (path: string): boolean => mocks.exists.has(path),
  },
}));

import { collectServerStats } from '@/lib/server-stats';

const HOST_PROC = '/host/proc';
const HOST_NET_DEV = '/host/proc-net/dev';
const CONTAINER_NET_DEV = '/proc/net/dev';

const HOST_STAT = 'cpu  1 0 1 1 0 0 0 0 0 0\n';
const HOST_MEMINFO = 'MemTotal: 1000 kB\nMemAvailable: 500 kB\n';
const HOST_UPTIME = '100.00 200.00\n';

// Loopback is skipped and eth0 is summed, which is the parse the collector must go through.
function netDev(rx: number, tx: number): string {
  return [
    'Inter-|   Receive                                                |  Transmit',
    ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
    '    lo: 1 0 0 0 0 0 0 0 1 0 0 0 0 0 0 0',
    `  eth0: ${rx} 0 0 0 0 0 0 0 ${tx} 0 0 0 0 0 0 0`,
  ].join('\n');
}

function giveHostProc(): void {
  mocks.files.set(`${HOST_PROC}/stat`, HOST_STAT);
  mocks.files.set(`${HOST_PROC}/meminfo`, HOST_MEMINFO);
  mocks.files.set(`${HOST_PROC}/uptime`, HOST_UPTIME);
  mocks.exists.add(`${HOST_PROC}/stat`);
  mocks.exists.add(`${HOST_PROC}/meminfo`);
}

beforeEach(() => {
  mocks.files.clear();
  mocks.exists.clear();
});

describe('collectServerStats figure sources', () => {
  it('prefers the host counters over the container when the host source is readable', async () => {
    giveHostProc();
    mocks.files.set(HOST_NET_DEV, netDev(5000, 7000));
    mocks.files.set(CONTAINER_NET_DEV, netDev(111, 222));

    const stats = await collectServerStats();

    expect(stats.source).toBe('host');
    expect(stats.network).toEqual({ rx: 5000, tx: 7000, source: 'host' });
  });

  it('labels the container fallback honestly when the host net source is unreadable', async () => {
    giveHostProc();
    mocks.files.set(CONTAINER_NET_DEV, netDev(111, 222));

    const stats = await collectServerStats();

    // The CPU/RAM/uptime mounts are present, so those figures are the host's; only the net figure fell back.
    expect(stats.source).toBe('host');
    expect(stats.network?.source).toBe('container');
    expect(stats.network).toEqual({ rx: 111, tx: 222, source: 'container' });
  });

  it('does not produce a host-labelled number from an unreadable host source', async () => {
    giveHostProc();
    mocks.files.set(CONTAINER_NET_DEV, netDev(3, 4));

    const stats = await collectServerStats();

    expect(stats.network?.source).not.toBe('host');
  });

  it('still labels itself container when no host mount exists at all', async () => {
    mocks.files.set(CONTAINER_NET_DEV, netDev(9, 10));

    const stats = await collectServerStats();

    expect(stats.source).toBe('container');
    expect(stats.network).toEqual({ rx: 9, tx: 10, source: 'container' });
  });

  it('shows the network figure as unavailable when neither source can be read', async () => {
    giveHostProc();

    const stats = await collectServerStats();

    expect(stats.network).toBeNull();
  });

  it('scopes each figure on its own, so a host net mount with no proc mount still reads host', async () => {
    mocks.files.set(HOST_NET_DEV, netDev(5000, 7000));
    mocks.files.set(CONTAINER_NET_DEV, netDev(111, 222));

    const stats = await collectServerStats();

    expect(stats.source).toBe('container');
    expect(stats.network).toEqual({ rx: 5000, tx: 7000, source: 'host' });
  });
});
