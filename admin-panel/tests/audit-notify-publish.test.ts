import { describe, expect, it, vi } from 'vitest';

const published: { id: string; detail: string }[] = [];
const discordCalls: { title: string; detail: string }[] = [];

vi.mock('@/lib/notification-queue', () => ({
  publishNotification: (frame: { id: string; detail: string }) => {
    published.push(frame);
  },
}));
vi.mock('@/lib/discord-notifier', () => ({
  logToDiscord: vi.fn(async (title: string, detail: string) => {
    discordCalls.push({ title, detail });
  }),
}));
vi.mock('@/lib/auth', () => ({
  getSession: async () => ({ userId: '2' }),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    audit_log: {
      findFirst: async () => ({ entry_hash: null }),
      create: async () => ({ id: BigInt(7), timestamp: new Date(0) }),
    },
    admins: { findUnique: async () => ({ name: 'Ada', username: 'ada' }) },
    contests: { findUnique: async () => ({ name: 'Midterm' }) },
  },
}));

describe('recordAudit publishing', () => {
  it('publishes a named frame once for deployment deploy', async () => {
    published.length = 0;
    discordCalls.length = 0;
    const { recordAudit } = await import('@/lib/audit');
    await recordAudit({ verb: 'deployment:deploy', entity: 'deployment', entityId: '3', result: 'success' });
    expect(published).toHaveLength(1);
    expect(published[0].detail).toContain('Ada');
    expect(published[0].detail).toContain('Midterm');
    expect(discordCalls).toHaveLength(0);
  });

  it('pages discord for sensitive verbs only', async () => {
    published.length = 0;
    discordCalls.length = 0;
    const { recordAudit } = await import('@/lib/audit');
    await recordAudit({ verb: 'override:set', entity: 'service', result: 'success' });
    expect(published).toHaveLength(1);
    expect(discordCalls).toHaveLength(1);
  });

  it('falls back to ids when names are gone', async () => {
    published.length = 0;
    vi.resetModules();
    vi.doMock('@/lib/notification-queue', () => ({
      publishNotification: (frame: { id: string; detail: string }) => {
        published.push(frame);
      },
    }));
    vi.doMock('@/lib/discord-notifier', () => ({ logToDiscord: vi.fn(async () => undefined) }));
    vi.doMock('@/lib/auth', () => ({ getSession: async () => ({ userId: '2' }) }));
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        audit_log: {
          findFirst: async () => ({ entry_hash: null }),
          create: async () => ({ id: BigInt(8), timestamp: new Date(0) }),
        },
        admins: { findUnique: async () => null },
        contests: { findUnique: async () => null },
      },
    }));
    const { recordAudit } = await import('@/lib/audit');
    await recordAudit({ verb: 'deployment:deploy', entity: 'deployment', entityId: '3', result: 'failure', actorId: 2 });
    expect(published).toHaveLength(1);
    expect(published[0].detail).toContain('admin #2');
    expect(published[0].detail).toContain('deployment #3');
  });

  it('skips name lookups for rows that notify nowhere', async () => {
    published.length = 0;
    discordCalls.length = 0;
    vi.resetModules();
    const lookups: string[] = [];
    vi.doMock('@/lib/notification-queue', () => ({
      publishNotification: (frame: { id: string; detail: string }) => {
        published.push(frame);
      },
    }));
    vi.doMock('@/lib/discord-notifier', () => ({ logToDiscord: vi.fn(async () => undefined) }));
    vi.doMock('@/lib/auth', () => ({ getSession: async () => ({ userId: '2' }) }));
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        audit_log: {
          findFirst: async () => ({ entry_hash: null }),
          create: async () => ({ id: BigInt(9), timestamp: new Date(0) }),
        },
        admins: { findUnique: async () => { lookups.push('admins'); return null; } },
        contests: { findUnique: async () => { lookups.push('contests'); return null; } },
      },
    }));
    const { recordAudit } = await import('@/lib/audit');
    await recordAudit({ verb: 'contest:list', entity: 'contest', result: 'success' });
    expect(published).toHaveLength(0);
    expect(lookups).toHaveLength(0);
  });

  it('still publishes when the entity id is not numeric', async () => {
    published.length = 0;
    vi.resetModules();
    vi.doMock('@/lib/notification-queue', () => ({
      publishNotification: (frame: { id: string; detail: string }) => {
        published.push(frame);
      },
    }));
    vi.doMock('@/lib/discord-notifier', () => ({ logToDiscord: vi.fn(async () => undefined) }));
    vi.doMock('@/lib/auth', () => ({ getSession: async () => ({ userId: '2' }) }));
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        audit_log: {
          findFirst: async () => ({ entry_hash: null }),
          create: async () => ({ id: BigInt(10), timestamp: new Date(0) }),
        },
        admins: { findUnique: async () => ({ name: 'Ada', username: 'ada' }) },
        contests: {
          findUnique: async () => {
            throw new Error('Invalid ID');
          },
        },
      },
    }));
    const { recordAudit } = await import('@/lib/audit');
    await recordAudit({ verb: 'deployment:deploy', entity: 'deployment', entityId: 'xyz', result: 'success' });
    expect(published).toHaveLength(1);
    expect(published[0].detail).toContain('deployment #xyz');
  });
});
