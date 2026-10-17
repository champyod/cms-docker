import { beforeEach, describe, expect, it, vi } from 'vitest';

// WHY the mocks: the CLI's job is to read a verb and hand it to the shared module as the `root`
// actor, so what these assert is the hand-off — which function was called, with which actor and
// which parsed values, and that a refusal stops the command instead of being swallowed.
const mocks = vi.hoisted(() => ({
  resolveRootActorId: vi.fn(),
  bindServiceContest: vi.fn(),
  showConfigTarget: vi.fn(),
  endConfigTargets: vi.fn(),
  addOverride: vi.fn(),
  endOverrides: vi.fn(),
}));

vi.mock('@/lib/panel-actions', () => mocks);

import { PanelUsageError, parsePanelCommand, runPanelCommand } from '@/cli/panel';

const ROOT_ACTOR = 11;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveRootActorId.mockResolvedValue(ROOT_ACTOR);
  mocks.bindServiceContest.mockResolvedValue(undefined);
  mocks.showConfigTarget.mockResolvedValue(undefined);
  mocks.endConfigTargets.mockResolvedValue(1);
  mocks.addOverride.mockResolvedValue(undefined);
  mocks.endOverrides.mockResolvedValue(1);
});

describe('cms panel parsing', () => {
  it('reads a registry binding, including the cleared form', () => {
    expect(parsePanelCommand(['registry', 'bind', 'cms-proxy-1', '--contest', '9'])).toEqual({
      area: 'registry',
      service: 'cms-proxy-1',
      contestId: 9,
    });
    expect(parsePanelCommand(['registry', 'bind', 'cms-proxy-1', '--contest', 'none'])).toEqual({
      area: 'registry',
      service: 'cms-proxy-1',
      contestId: null,
    });
  });

  it('refuses a binding target that is neither an id nor "none"', () => {
    expect(() => parsePanelCommand(['registry', 'bind', 'cms-proxy-1', '--contest', 'day2'])).toThrow(
      PanelUsageError,
    );
    expect(() => parsePanelCommand(['registry', 'bind', 'cms-proxy-1', '--contest', 'day2'])).toThrow(
      "--contest takes a contest id or 'none'",
    );
  });

  it('reads a config show and a config end', () => {
    expect(parsePanelCommand(['config', 'show', '9', '--reason', 'day two goes live'])).toEqual({
      area: 'config',
      verb: 'show',
      contestId: '9',
      reason: 'day two goes live',
    });
    expect(parsePanelCommand(['config', 'end', '4', '--reason', 'over'])).toEqual({
      area: 'config',
      verb: 'end',
      configId: '4',
      reason: 'over',
    });
  });

  it('reads an override add, taking the whole-board key from the kind', () => {
    expect(
      parsePanelCommand(['override', 'add', '--contest', '9', '--kind', 'ranking', '--action', 'freeze', '--reason', 'freeze it']),
    ).toEqual({
      area: 'override',
      verb: 'add',
      contestId: '9',
      kind: 'ranking',
      key: '',
      action: 'freeze',
      value: '',
      reason: 'freeze it',
    });
  });

  it('reads an override end', () => {
    expect(parsePanelCommand(['override', 'end', '12', '--reason', 'mistake'])).toEqual({
      area: 'override',
      verb: 'end',
      overrideId: 12,
      reason: 'mistake',
    });
  });

  it.each([
    [['registry', 'show', 'x'], "registry takes 'bind'"],
    [['config', 'drop', '9', '--reason', 'x'], 'config takes show or end'],
    [['override', 'remove', '9', '--reason', 'x'], 'override takes add or end'],
    [['ranking', 'show'], 'unknown area "ranking"'],
  ])('refuses the verb shape %j', (argv, message) => {
    expect(() => parsePanelCommand(argv)).toThrow(message);
  });

  it.each([
    [['registry', 'bind'], 'missing the service to bind'],
    [['config', 'show', '--reason', 'x'], 'missing the target id'],
    [['override', 'end', '--reason', 'x'], 'missing the override to end'],
    [['config', 'show', '9'], '--reason is required'],
    [['override', 'end', '12', '--reason', 'x', '--extra', 'y'], 'unknown option --extra'],
    [['override', 'add', 'stray', '--contest', '9'], 'unexpected argument "stray"'],
    [['config', 'show', '9', '--reason'], '--reason needs a value'],
    [['override', 'end', 'twelve', '--reason', 'x'], 'the override id is a number'],
  ])('refuses the argument shape %j', (argv, message) => {
    expect(() => parsePanelCommand(argv)).toThrow(message);
  });
});

describe('cms panel running', () => {
  it('binds a shard to a contest as the root actor', async () => {
    const line = await runPanelCommand(parsePanelCommand(['registry', 'bind', 'cms-proxy-1', '--contest', '9']));

    expect(mocks.bindServiceContest).toHaveBeenCalledWith(ROOT_ACTOR, { service: 'cms-proxy-1', contestId: 9 });
    expect(line).toBe('cms-proxy-1 now serves contest 9.');
  });

  it('shows a contest on the board as the root actor', async () => {
    await runPanelCommand(parsePanelCommand(['config', 'show', '9', '--reason', 'day two goes live']));

    expect(mocks.showConfigTarget).toHaveBeenCalledWith(ROOT_ACTOR, {
      kind: 'contest',
      targetKey: '9',
      reason: 'day two goes live',
    });
  });

  it('ends a shown target as the root actor', async () => {
    await runPanelCommand(parsePanelCommand(['config', 'end', '4', '--reason', 'over']));

    expect(mocks.endConfigTargets).toHaveBeenCalledWith(ROOT_ACTOR, ['4'], 'over');
  });

  it('files an override as the root actor', async () => {
    await runPanelCommand(
      parsePanelCommand([
        'override', 'add', '--contest', '9', '--kind', 'task', '--key', 'Day_202/A_20Plus_20B',
        '--action', 'hide', '--reason', 'withdrawn',
      ]),
    );

    expect(mocks.addOverride).toHaveBeenCalledWith(ROOT_ACTOR, {
      contestId: '9',
      targetKind: 'task',
      targetKey: 'Day_202/A_20Plus_20B',
      action: 'hide',
      value: '',
      reason: 'withdrawn',
    });
  });

  it('ends an override as the root actor', async () => {
    await runPanelCommand(parsePanelCommand(['override', 'end', '12', '--reason', 'mistake']));

    expect(mocks.endOverrides).toHaveBeenCalledWith(ROOT_ACTOR, [12], 'mistake');
  });

  it('performs nothing when no root actor can be resolved', async () => {
    // A write filed as NULL is the one outcome the actor contract forbids, so an unresolvable
    // actor has to stop the command before any write runs.
    mocks.resolveRootActorId.mockRejectedValue(new Error('no admin named root to attribute this write to'));

    await expect(runPanelCommand(parsePanelCommand(['config', 'show', '9', '--reason', 'x']))).rejects.toThrow(
      'no admin named root',
    );
    expect(mocks.showConfigTarget).not.toHaveBeenCalled();
  });

  it('surfaces a refusal from the shared module instead of swallowing it', async () => {
    mocks.addOverride.mockRejectedValue(new Error('unknown override target: banner'));

    await expect(
      runPanelCommand(parsePanelCommand(['override', 'add', '--contest', '9', '--kind', 'banner', '--action', 'hide', '--reason', 'x'])),
    ).rejects.toThrow('unknown override target: banner');
  });

  it('refuses to report success for an end that matched nothing', async () => {
    mocks.endConfigTargets.mockResolvedValue(0);
    mocks.endOverrides.mockResolvedValue(0);

    await expect(runPanelCommand(parsePanelCommand(['config', 'end', '999', '--reason', 'cleanup']))).rejects.toThrow(
      'no active shown target 999 to end',
    );
    await expect(runPanelCommand(parsePanelCommand(['override', 'end', '999', '--reason', 'cleanup']))).rejects.toThrow(
      'no active override 999 to end',
    );
  });
});
