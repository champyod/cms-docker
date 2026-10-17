import { beforeEach, describe, expect, it, vi } from 'vitest';

// WHY the mocks: what these assert is the semantics both boundaries share — which rows the writes
// touch, what a refusal names, and what trail a script-side write leaves — so the writes are
// observed rather than exercised against a database.
const mocks = vi.hoisted(() => ({
  configCreate: vi.fn(),
  configUpdateMany: vi.fn(),
  overrideCreate: vi.fn(),
  overrideUpdateMany: vi.fn(),
  contestFindUnique: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    ranking_config: { create: mocks.configCreate, updateMany: mocks.configUpdateMany },
    ranking_overrides: { create: mocks.overrideCreate, updateMany: mocks.overrideUpdateMany },
    contests: { findUnique: mocks.contestFindUnique },
    $executeRaw: mocks.executeRaw,
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));

import {
  addOverride,
  endConfigTargets,
  endOverrides,
  showConfigTarget,
} from '@/lib/panel-actions';

const ACTOR = 7;

const CONTEST_ROW = {
  id: 9,
  name: 'POSN Oct 2026 Day 2',
  description: 'Day Two',
  start: new Date('2026-10-16T00:00:00Z'),
  stop: new Date('2026-10-17T00:00:00Z'),
  score_precision: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configCreate.mockReturnValue({ tag: 'config-create' });
  mocks.executeRaw.mockReturnValue({ tag: 'raw' });
  mocks.transaction.mockImplementation(async (statements: unknown) => (Array.isArray(statements) ? statements : []));
  mocks.contestFindUnique.mockResolvedValue(CONTEST_ROW);
  mocks.recordAudit.mockResolvedValue(undefined);
});

describe('showConfigTarget', () => {
  it('writes the config row and the projection row in one transaction', async () => {
    await showConfigTarget(ACTOR, { kind: 'contest', targetKey: '9', reason: 'day two goes live' });

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect((mocks.transaction.mock.calls[0][0] as readonly unknown[])).toHaveLength(3);
    expect(mocks.configCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ target_kind: 'contest', target_key: '9', created_by: ACTOR }) }),
    );
  });

  it('files the show under the actor it was told to use', async () => {
    await showConfigTarget(ACTOR, { kind: 'contest', targetKey: '9', reason: 'day two goes live' });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ACTOR, verb: 'ranking:config:show', result: 'success' }),
    );
  });

  it('refuses a target kind the reader could not draw', async () => {
    await expect(showConfigTarget(ACTOR, { kind: 'task', targetKey: '9', reason: 'because' })).rejects.toThrow(
      'unknown config target: task',
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('refuses a key that is not a contest id', async () => {
    await expect(
      showConfigTarget(ACTOR, { kind: 'contest', targetKey: 'day-two', reason: 'because' }),
    ).rejects.toThrow('a shown target key is a contest id');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('refuses a show with no reason', async () => {
    await expect(showConfigTarget(ACTOR, { kind: 'contest', targetKey: '9', reason: '  ' })).rejects.toThrow(
      'showing a target needs a reason',
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('refuses a scope the ranking does not serve', async () => {
    mocks.contestFindUnique.mockResolvedValue(null);
    await expect(showConfigTarget(ACTOR, { kind: 'contest', targetKey: '404', reason: 'because' })).rejects.toThrow(
      'No contest with id 404 to project',
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe('endConfigTargets', () => {
  it('ends the named row without deleting it, and answers how many it ended', async () => {
    mocks.configUpdateMany.mockResolvedValue({ count: 1 });
    expect(await endConfigTargets(ACTOR, ['4'], 'day two is over')).toBe(1);

    expect(mocks.configUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [BigInt(4)] }, active: true },
      data: expect.objectContaining({ active: false, ended_by: ACTOR }),
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ACTOR, verb: 'ranking:config:end' }),
    );
  });

  it('answers zero when nothing matched, and files no audit row for a write that changed nothing', async () => {
    mocks.configUpdateMany.mockResolvedValue({ count: 0 });
    expect(await endConfigTargets(ACTOR, ['999'], 'cleanup')).toBe(0);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('refuses an end with no reason', async () => {
    await expect(endConfigTargets(ACTOR, ['4'], '   ')).rejects.toThrow('ending a shown target needs a reason');
    expect(mocks.configUpdateMany).not.toHaveBeenCalled();
  });

  it('refuses an id that is not an id rather than ending a subset', async () => {
    await expect(endConfigTargets(ACTOR, ['4', 'day-two'], 'cleanup')).rejects.toThrow(
      'not a shown-target id: day-two',
    );
    expect(mocks.configUpdateMany).not.toHaveBeenCalled();
  });

  it('refuses an empty selection', async () => {
    await expect(endConfigTargets(ACTOR, [], 'cleanup')).rejects.toThrow('select at least one target to end');
    expect(mocks.configUpdateMany).not.toHaveBeenCalled();
  });
});

describe('addOverride', () => {
  const DRAFT = {
    contestId: '9',
    targetKind: 'task',
    targetKey: 'Day_202/A_20Plus_20B',
    action: 'hide',
    value: '',
    reason: 'withdrawn',
  };

  it('files the override under the actor and the scope it was told to use', async () => {
    await addOverride(ACTOR, DRAFT);

    expect(mocks.overrideCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contest_id: 9,
        target_kind: 'task',
        target_key: 'Day_202/A_20Plus_20B',
        action: 'hide',
        payload: undefined,
        created_by: ACTOR,
      }),
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ACTOR, verb: 'ranking:override:create', result: 'success' }),
    );
  });

  it('refuses a target kind the reader could not draw', async () => {
    await expect(addOverride(ACTOR, { ...DRAFT, targetKind: 'banner' })).rejects.toThrow(
      'unknown override target: banner',
    );
    expect(mocks.overrideCreate).not.toHaveBeenCalled();
  });

  it('refuses a verb the kind cannot mean', async () => {
    await expect(addOverride(ACTOR, { ...DRAFT, action: 'rename' })).rejects.toThrow(
      'a task target does not accept the rename action',
    );
    expect(mocks.overrideCreate).not.toHaveBeenCalled();
  });

  it('refuses a scope the ranking does not serve', async () => {
    mocks.contestFindUnique.mockResolvedValue(null);
    await expect(addOverride(ACTOR, { ...DRAFT, contestId: '404' })).rejects.toThrow(
      'no contest with id 404 to scope this override',
    );
    expect(mocks.overrideCreate).not.toHaveBeenCalled();
  });

  it('refuses a contest id that is not an id', async () => {
    await expect(addOverride(ACTOR, { ...DRAFT, contestId: 'spring' })).rejects.toThrow(/needs the contest/);
    expect(mocks.overrideCreate).not.toHaveBeenCalled();
  });

  it('keeps the whole-board ranking reached without a key', async () => {
    await addOverride(ACTOR, { ...DRAFT, targetKind: 'ranking', action: 'freeze', targetKey: '' });
    expect(mocks.overrideCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ target_kind: 'ranking', target_key: '*', action: 'freeze' }),
    });
  });
});

describe('endOverrides', () => {
  it('ends the selection in one audited write, and answers how many it ended', async () => {
    mocks.overrideUpdateMany.mockResolvedValue({ count: 2 });
    expect(await endOverrides(ACTOR, [3, 4], 'day two is over')).toBe(2);

    expect(mocks.overrideUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [BigInt(3), BigInt(4)] }, active: true },
      data: expect.objectContaining({ active: false, ended_by: ACTOR }),
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ACTOR, verb: 'ranking:override:end' }),
    );
  });

  it('answers zero when nothing matched, and files no audit row for a write that changed nothing', async () => {
    mocks.overrideUpdateMany.mockResolvedValue({ count: 0 });
    expect(await endOverrides(ACTOR, [999], 'cleanup')).toBe(0);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('refuses an end with no reason', async () => {
    await expect(endOverrides(ACTOR, [3], '  ')).rejects.toThrow('ending an override needs a reason');
    expect(mocks.overrideUpdateMany).not.toHaveBeenCalled();
  });

  it('refuses an id that is not an id rather than ending a subset', async () => {
    await expect(endOverrides(ACTOR, [3, Number.NaN], 'cleanup')).rejects.toThrow(/not an override id/);
    expect(mocks.overrideUpdateMany).not.toHaveBeenCalled();
  });
});
