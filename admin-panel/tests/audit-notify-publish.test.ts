import { describe, expect, it, vi } from 'vitest';

const published: PublishedFrame[] = [];
const discordCalls: { title: string; detail: string }[] = [];

// Why the destination is part of the captured frame: the popup renders a link only from what the
// frame carries, so the field has to survive the publish step this suite exercises.
// Why the parts and not a sentence: the frame is what a Thai panel reads, so the sentence is composed
// where the reader's dictionary is — see `system-alert-copy.ts`.
interface PublishedFrame {
  id: string;
  cue: { kind: string; verb: string; actor: string; target: string };
  destination?: string;
}

vi.mock('@/lib/notification-queue', () => ({
  publishNotification: (frame: PublishedFrame) => {
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
    expect(published[0].cue.actor).toContain('Ada');
    expect(published[0].cue.target).toContain('Midterm');
    expect(published[0].cue.kind).toBe('critical');
    expect(published[0].destination).toBe('administration.audit');
    // Why this absence is the assertion: a sentence on the frame is what made the copy untranslatable.
    expect(published[0]).not.toHaveProperty('detail');
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
      publishNotification: (frame: PublishedFrame) => {
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
    expect(published[0].cue.actor).toContain('admin #2');
    expect(published[0].cue.target).toContain('deployment #3');
    expect(published[0].cue.kind).toBe('failed');
  });

  it('skips name lookups for rows that notify nowhere', async () => {
    published.length = 0;
    discordCalls.length = 0;
    vi.resetModules();
    const lookups: string[] = [];
    vi.doMock('@/lib/notification-queue', () => ({
      publishNotification: (frame: PublishedFrame) => {
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
      publishNotification: (frame: PublishedFrame) => {
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
    expect(published[0].cue.target).toContain('deployment #xyz');
  });
});
