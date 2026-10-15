import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  readActiveContestId: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { services: { findMany: mocks.findMany } },
}));
vi.mock('@/lib/active-contest', () => ({ readActiveContestId: mocks.readActiveContestId }));
vi.mock('@/lib/repo-root', () => ({ getRepoRoot: () => '/repo' }));
vi.mock('fs/promises', () => ({ default: { readFile: mocks.readFile } }));

import { readContestWebServerShard, resolveContestBinding } from '@/lib/contest-binding';
import { CONTEST_WEB_SERVER_ROLE, SERVICE_ROLES } from '@/lib/service-wiring-contract';

function row(contest_id: number | null) {
  return { contest_id };
}

function configWithShard(shard: string): string {
  return `[core]\nACTIVE_DATABASE = "default"\n\n[contest]\nCONTEST_ID = 1\nCONTEST_WEB_SERVER_SHARD = ${shard}\n\n[worker]\n`;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readActiveContestId.mockResolvedValue(7);
  mocks.readFile.mockResolvedValue(configWithShard('0'));
});

describe('resolveContestBinding', () => {
  it('answers with the contest the row for this shard names', async () => {
    mocks.findMany.mockResolvedValue([row(3)]);
    expect(await resolveContestBinding(1)).toEqual({ source: 'registry', contestId: 3 });
  });

  it('keeps a row that names no contest as serving every one of them', async () => {
    mocks.findMany.mockResolvedValue([row(null)]);
    expect(await resolveContestBinding(0)).toEqual({ source: 'registry', contestId: null });
  });

  it('falls back to the active contest when no enabled row names the shard', async () => {
    mocks.findMany.mockResolvedValue([]);
    expect(await resolveContestBinding(0)).toEqual({ source: 'deployment', contestId: 7 });
  });

  it('reads the active contest only when the registry has no row', async () => {
    mocks.findMany.mockResolvedValue([row(3)]);
    await resolveContestBinding(0);
    expect(mocks.readActiveContestId).not.toHaveBeenCalled();
  });

  it('asks for the enabled row of the declared role and this shard, lowest id first', async () => {
    mocks.findMany.mockResolvedValue([]);
    await resolveContestBinding(2);
    expect(SERVICE_ROLES).toContain(CONTEST_WEB_SERVER_ROLE);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: CONTEST_WEB_SERVER_ROLE, shard: 2, enabled: true },
        orderBy: { id: 'asc' },
      }),
    );
  });
});

describe('readContestWebServerShard', () => {
  it('reads the shard compose would hand the contest web server', async () => {
    mocks.readFile.mockResolvedValue(configWithShard('2'));
    expect(await readContestWebServerShard()).toBe(2);
  });

  it('keeps compose defaulting a key the file never set', async () => {
    mocks.readFile.mockResolvedValue('[contest]\nCONTEST_ID = 1\n');
    expect(await readContestWebServerShard()).toBe(0);
  });

  it('keeps the default for a value that is not a shard rather than failing the page', async () => {
    mocks.readFile.mockResolvedValue(configWithShard('"first"'));
    expect(await readContestWebServerShard()).toBe(0);
  });
});
