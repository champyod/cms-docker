import { beforeEach, describe, expect, it, vi } from 'vitest';

// WHY the mocks: the CLI's job is to read a verb and hand it to the shared module as the `root`
// actor, so what these assert is the hand-off — which function was called, with which actor and
// which parsed values, and that a refusal stops the command instead of being swallowed.
const mocks = vi.hoisted(() => ({
  resolveRootActorId: vi.fn(),
  bindServiceContest: vi.fn(),
  saveService: vi.fn(),
  removeService: vi.fn(),
  saveWiring: vi.fn(),
  removeWiring: vi.fn(),
  saveExposure: vi.fn(),
  removeExposure: vi.fn(),
  showConfigTarget: vi.fn(),
  endConfigTargets: vi.fn(),
  addOverride: vi.fn(),
  addOverrides: vi.fn(),
  endOverrides: vi.fn(),
  attachContestTasks: vi.fn(),
  detachContestTasks: vi.fn(),
  rotateContestAccounts: vi.fn(),
  createWaiver: vi.fn(),
  endWaiver: vi.fn(),
}));

vi.mock('@/lib/panel-actions', () => mocks);

import { PanelUsageError, PANEL_USAGE, PANEL_WRITE_VERBS, parsePanelCommand, runPanelCommand } from '@/cli/panel';

const ROOT_ACTOR = 11;

const WRITTEN = { success: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveRootActorId.mockResolvedValue(ROOT_ACTOR);
  mocks.bindServiceContest.mockResolvedValue(undefined);
  mocks.saveService.mockResolvedValue(WRITTEN);
  mocks.removeService.mockResolvedValue(WRITTEN);
  mocks.saveWiring.mockResolvedValue(WRITTEN);
  mocks.removeWiring.mockResolvedValue(WRITTEN);
  mocks.saveExposure.mockResolvedValue(WRITTEN);
  mocks.removeExposure.mockResolvedValue(WRITTEN);
  mocks.showConfigTarget.mockResolvedValue(undefined);
  mocks.endConfigTargets.mockResolvedValue(1);
  mocks.addOverride.mockResolvedValue(undefined);
  mocks.addOverrides.mockResolvedValue(2);
  mocks.endOverrides.mockResolvedValue(1);
  mocks.attachContestTasks.mockResolvedValue(2);
  mocks.detachContestTasks.mockResolvedValue(2);
  mocks.rotateContestAccounts.mockResolvedValue({ rotated: 2, assigned: 2 });
  mocks.createWaiver.mockResolvedValue({ success: true, id: 5 });
  mocks.endWaiver.mockResolvedValue({ success: true, id: 5 });
});

describe('cms panel parsing', () => {
  it('reads a registry binding, including the cleared form', () => {
    expect(parsePanelCommand(['registry', 'bind', 'cms-proxy-1', '--contest', '9'])).toEqual({
      area: 'registry',
      verb: 'bind',
      service: 'cms-proxy-1',
      contestId: 9,
    });
    expect(parsePanelCommand(['registry', 'bind', 'cms-proxy-1', '--contest', 'none'])).toEqual({
      area: 'registry',
      verb: 'bind',
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

  it('reads a service row, taking the panel form default for every field the caller omits', () => {
    expect(
      parsePanelCommand([
        'registry', 'service', 'set',
        '--name', 'cms-contest-2',
        '--role', 'ContestWebServer',
        '--host', 'cms-contest-2',
        '--http-port', '8081',
      ]),
    ).toEqual({
      area: 'registry',
      verb: 'service-set',
      service: {
        id: undefined,
        name: 'cms-contest-2',
        role: 'ContestWebServer',
        shard: 0,
        host: 'cms-contest-2',
        http_port: 8081,
        rpc_port: null,
        db_profile: 'default',
        contest_id: null,
        enabled: true,
        image: '',
        pull_policy: 'missing',
      },
    });
  });

  it('reads a service row correction, with the row id and the disabled switch', () => {
    const parsed = parsePanelCommand([
      'registry', 'service', 'set', '--id', '7',
      '--name', 'cms-worker-3', '--role', 'Worker', '--host', 'cms-worker-3',
      '--rpc-port', '6061', '--db-profile', 'evaluate', '--contest', 'none',
      '--image', 'registry.example/cms-worker:1.4.0', '--pull-policy', 'always', '--disabled',
    ]);

    expect(parsed).toEqual({
      area: 'registry',
      verb: 'service-set',
      service: {
        id: 7,
        name: 'cms-worker-3',
        role: 'Worker',
        shard: 0,
        host: 'cms-worker-3',
        http_port: null,
        rpc_port: 6061,
        db_profile: 'evaluate',
        contest_id: null,
        enabled: false,
        image: 'registry.example/cms-worker:1.4.0',
        pull_policy: 'always',
      },
    });
  });

  it('reads a wiring and an exposure, each with the one switch it offers', () => {
    expect(
      parsePanelCommand(['registry', 'wiring', 'set', '--from', '1', '--to', '2', '--relation', 'drains']),
    ).toEqual({
      area: 'registry',
      verb: 'wiring-set',
      wiring: { id: undefined, from_service_id: 1, to_service_id: 2, relation: 'drains', enabled: true },
    });
    expect(
      parsePanelCommand(['registry', 'exposure', 'set', '--service', '1', '--path', '/beta', '--no-tls']),
    ).toEqual({
      area: 'registry',
      verb: 'exposure-set',
      exposure: { id: undefined, service_id: 1, hostname: '', path: '/beta', tls: false, tailnet: null },
    });
  });

  it('reads an exposure with no path as the root location', () => {
    expect(parsePanelCommand(['registry', 'exposure', 'set', '--service', '1'])).toEqual({
      area: 'registry',
      verb: 'exposure-set',
      exposure: { id: undefined, service_id: 1, hostname: '', path: '/', tls: true, tailnet: null },
    });
  });

  it('reads the registry row removals by id', () => {
    expect(parsePanelCommand(['registry', 'service', 'remove', '7'])).toEqual({
      area: 'registry',
      verb: 'service-remove',
      id: 7,
    });
    expect(parsePanelCommand(['registry', 'wiring', 'remove', '3'])).toEqual({
      area: 'registry',
      verb: 'wiring-remove',
      id: 3,
    });
    expect(parsePanelCommand(['registry', 'exposure', 'remove', '5'])).toEqual({
      area: 'registry',
      verb: 'exposure-remove',
      id: 5,
    });
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
      configIds: ['4'],
      reason: 'over',
    });
    expect(parsePanelCommand(['config', 'end', '4', '5', '--reason', 'over'])).toEqual({
      area: 'config',
      verb: 'end',
      configIds: ['4', '5'],
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
      keys: [''],
      action: 'freeze',
      value: '',
      reason: 'freeze it',
    });
  });

  it('reads several --key as one selection, so the bulk write is reachable', () => {
    expect(
      parsePanelCommand([
        'override', 'add', '--contest', '9', '--kind', 'task', '--action', 'hide',
        '--key', 'Day_1/A', '--key', 'Day_1/B', '--reason', 'withdrawn',
      ]),
    ).toEqual({
      area: 'override',
      verb: 'add',
      contestId: '9',
      kind: 'task',
      keys: ['Day_1/A', 'Day_1/B'],
      action: 'hide',
      value: '',
      reason: 'withdrawn',
    });
  });

  it('reads an override end, one id or a selection', () => {
    expect(parsePanelCommand(['override', 'end', '12', '--reason', 'mistake'])).toEqual({
      area: 'override',
      verb: 'end',
      overrideIds: [12],
      reason: 'mistake',
    });
    expect(parsePanelCommand(['override', 'end', '12', '13', '--reason', 'mistake'])).toEqual({
      area: 'override',
      verb: 'end',
      overrideIds: [12, 13],
      reason: 'mistake',
    });
  });

  it('reads a task selection, accepting a comma list as several ids', () => {
    expect(parsePanelCommand(['task', 'attach', '9', '--task', '4,5'])).toEqual({
      area: 'task',
      verb: 'attach',
      contestId: 9,
      taskIds: [4, 5],
    });
    expect(parsePanelCommand(['task', 'detach', '9', '--task', '4'])).toEqual({
      area: 'task',
      verb: 'detach',
      contestId: 9,
      taskIds: [4],
    });
  });

  it('reads the day-two rotation, with and without a team', () => {
    expect(
      parsePanelCommand(['accounts', 'rotate', '9', '--user', '12,13', '--team', '3', '--reason', 'day two']),
    ).toEqual({
      area: 'accounts',
      verb: 'rotate',
      contestId: 9,
      userIds: [12, 13],
      teamId: 3,
      reason: 'day two',
    });
    expect(
      parsePanelCommand(['accounts', 'rotate', '9', '--user', '12', '--reason', 'day two']),
    ).toEqual({
      area: 'accounts',
      verb: 'rotate',
      contestId: 9,
      userIds: [12],
      teamId: null,
      reason: 'day two',
    });
  });

  it('reads a waiver, and its ending by id', () => {
    expect(
      parsePanelCommand([
        'waiver', 'create', '--source', 'osv', '--match', 'CVE-2026-1234',
        '--review-by', '2027-01-31', '--reason', 'tracked upstream',
      ]),
    ).toEqual({
      area: 'waiver',
      verb: 'create',
      waiver: { source: 'osv', match: 'CVE-2026-1234', reviewBy: '2027-01-31', reason: 'tracked upstream' },
    });
    expect(parsePanelCommand(['waiver', 'end', '5', '--reason', 'patched'])).toEqual({
      area: 'waiver',
      verb: 'end',
      waiverId: 5,
      reason: 'patched',
    });
  });

  it.each([
    [['registry', 'show', 'x'], 'registry takes bind, service, wiring or exposure'],
    [['registry', 'service', 'add', '--name', 'x'], 'registry service takes set or remove'],
    [['config', 'drop', '9', '--reason', 'x'], 'config takes show or end'],
    [['override', 'remove', '9', '--reason', 'x'], 'override takes add or end'],
    [['task', 'reorder', '9', '--task', '1'], 'task takes attach or detach'],
    [['accounts', 'reset', '9', '--user', '1'], 'accounts takes rotate'],
    [['waiver', 'extend', '5', '--reason', 'x'], 'waiver takes create or end'],
    [['ranking', 'show'], 'unknown area "ranking"'],
  ])('refuses the verb shape %j', (argv, message) => {
    expect(() => parsePanelCommand(argv)).toThrow(message);
  });

  it.each([
    [['registry', 'bind'], 'missing the service to bind'],
    [['registry', 'service', 'remove'], 'missing the service row to remove'],
    [['registry', 'service', 'remove', 'seven'], 'the service row id is a number'],
    [['registry', 'service', 'set', '--role', 'Worker', '--host', 'h'], '--name is required'],
    [['registry', 'service', 'set', '--name', 'n', '--host', 'h'], '--role is required'],
    [['registry', 'wiring', 'set', '--to', '2', '--relation', 'r'], '--from is required'],
    [['registry', 'wiring', 'set', '--from', '1', '--to', '2'], '--relation is required'],
    [['registry', 'exposure', 'set', '--path', '/beta'], '--service is required'],
    [['registry', 'exposure', 'set', '--service', 'one'], 'the service the exposure fronts is a number'],
    [['registry', 'service', 'remove', '7', '--reason', 'x'], 'unknown option --reason'],
    [['config', 'show', '--reason', 'x'], 'missing the target id'],
    [['config', 'show', '9'], '--reason is required'],
    [['config', 'end', '--reason', 'x'], 'missing the target id'],
    [['override', 'end', '--reason', 'x'], 'missing the override to end'],
    [['override', 'end', '12', '--reason', 'x', '--extra', 'y'], 'unknown option --extra'],
    [['override', 'add', 'stray', '--contest', '9'], 'unexpected argument "stray"'],
    [['config', 'show', '9', '--reason'], '--reason needs a value'],
    [['override', 'end', 'twelve', '--reason', 'x'], 'the override id is a number'],
    [['task', 'attach'], 'missing the contest'],
    [['task', 'attach', 'nine', '--task', '4'], 'the contest id is a number'],
    [['task', 'attach', '9', '--task', 'four'], 'a task id is a number'],
    [['accounts', 'rotate', '9', '--user', '12'], '--reason is required'],
    [['accounts', 'rotate', '9', '--user', 'twelve', '--reason', 'x'], 'an account id is a number'],
    [['waiver', 'end', '--reason', 'patched'], 'missing the waiver to end'],
    [['waiver', 'end', 'five', '--reason', 'patched'], 'the waiver id is a number'],
    [['waiver', 'create', '--source', 'osv', '--match', 'CVE-1', '--reason', 'x'], '--review-by is required'],
    [['waiver', 'create', '--match', 'CVE-1', '--review-by', '2027-01-31', '--reason', 'x'], '--source is required'],
  ])('refuses the argument shape %j', (argv, message) => {
    expect(() => parsePanelCommand(argv)).toThrow(message);
  });

  it('names every verb it dispatches on in the usage it prints', () => {
    // WHY: the usage is the only place an operator learns a verb exists, so a verb the table
    // knows and the help does not is a write nobody can find.
    const unlisted = PANEL_WRITE_VERBS.map((row) => row.verb.join(' ')).filter(
      (verb) => !PANEL_USAGE.includes(verb),
    );
    expect([...new Set(unlisted)]).toEqual([]);
  });
});

describe('cms panel running', () => {
  it('binds a shard to a contest as the root actor', async () => {
    const line = await runPanelCommand(parsePanelCommand(['registry', 'bind', 'cms-proxy-1', '--contest', '9']));

    expect(mocks.bindServiceContest).toHaveBeenCalledWith(ROOT_ACTOR, { service: 'cms-proxy-1', contestId: 9 });
    expect(line).toBe('cms-proxy-1 now serves contest 9.');
  });

  it('saves a service row as the root actor, stating which row it wrote', async () => {
    const added = await runPanelCommand(
      parsePanelCommand(['registry', 'service', 'set', '--name', 'cms-worker-3', '--role', 'Worker', '--host', 'cms-worker-3']),
    );
    expect(mocks.saveService).toHaveBeenCalledWith(ROOT_ACTOR, expect.objectContaining({ name: 'cms-worker-3', role: 'Worker' }));
    expect(added).toBe('service cms-worker-3 added to the registry.');

    const edited = await runPanelCommand(
      parsePanelCommand(['registry', 'service', 'set', '--id', '7', '--name', 'cms-worker-3', '--role', 'Worker', '--host', 'cms-worker-3']),
    );
    expect(edited).toBe('service cms-worker-3 (row 7) saved.');
  });

  it('removes registry rows without demanding an actor the write does not take', async () => {
    // WHY: `removeService` and the other row-level writes have no actor argument — the panel's
    // action calls them with none — so a CLI that refused them for a missing `root` admin would
    // refuse a write the panel performs from the same function.
    mocks.resolveRootActorId.mockRejectedValue(new Error('no admin named root'));

    await expect(runPanelCommand(parsePanelCommand(['registry', 'service', 'remove', '7']))).resolves.toBe(
      'service row 7 removed.',
    );
    expect(mocks.removeService).toHaveBeenCalledWith(7);
  });

  it('saves a wiring and an exposure as the shared writes state them', async () => {
    await runPanelCommand(
      parsePanelCommand(['registry', 'wiring', 'set', '--from', '1', '--to', '2', '--relation', 'drains']),
    );
    expect(mocks.saveWiring).toHaveBeenCalledWith({
      id: undefined,
      from_service_id: 1,
      to_service_id: 2,
      relation: 'drains',
      enabled: true,
    });

    await runPanelCommand(
      parsePanelCommand(['registry', 'exposure', 'set', '--service', '1', '--path', '/beta', '--hostname', 'beta.example.org']),
    );
    expect(mocks.saveExposure).toHaveBeenCalledWith({
      id: undefined,
      service_id: 1,
      hostname: 'beta.example.org',
      path: '/beta',
      tls: true,
      tailnet: null,
    });
  });

  it('refuses to report success for a registry write the module rejected', async () => {
    // WHY: the row-level writes answer `{ success: false }` instead of throwing, so a CLI that
    // printed its line regardless would exit zero over a write the database refused.
    mocks.saveService.mockResolvedValue({ success: false, error: 'unsafe host: "bad host"' });

    await expect(
      runPanelCommand(
        parsePanelCommand(['registry', 'service', 'set', '--name', 'n', '--role', 'Worker', '--host', 'bad host']),
      ),
    ).rejects.toThrow('unsafe host: "bad host"');
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
    expect(mocks.addOverrides).not.toHaveBeenCalled();
  });

  it('files a whole selection through the bulk write, not one call per key', async () => {
    const line = await runPanelCommand(
      parsePanelCommand([
        'override', 'add', '--contest', '9', '--kind', 'task', '--action', 'hide',
        '--key', 'Day_1/A', '--key', 'Day_1/B', '--reason', 'withdrawn',
      ]),
    );

    expect(mocks.addOverrides).toHaveBeenCalledWith(ROOT_ACTOR, [
      { contestId: '9', targetKind: 'task', targetKey: 'Day_1/A', action: 'hide', value: '', reason: 'withdrawn' },
      { contestId: '9', targetKind: 'task', targetKey: 'Day_1/B', action: 'hide', value: '', reason: 'withdrawn' },
    ]);
    expect(mocks.addOverride).not.toHaveBeenCalled();
    expect(line).toBe('2 overrides hide task filed for contest 9.');
  });

  it('ends an override as the root actor', async () => {
    await runPanelCommand(parsePanelCommand(['override', 'end', '12', '--reason', 'mistake']));

    expect(mocks.endOverrides).toHaveBeenCalledWith(ROOT_ACTOR, [12], 'mistake');
  });

  it('attaches and detaches a task roster as the root actor', async () => {
    const attached = await runPanelCommand(parsePanelCommand(['task', 'attach', '9', '--task', '4,5']));
    expect(mocks.attachContestTasks).toHaveBeenCalledWith(ROOT_ACTOR, { contestId: 9, taskIds: [4, 5] });
    expect(attached).toBe('attached 2 tasks to contest 9.');

    const detached = await runPanelCommand(parsePanelCommand(['task', 'detach', '9', '--task', '4']));
    expect(mocks.detachContestTasks).toHaveBeenCalledWith(ROOT_ACTOR, { contestId: 9, taskIds: [4] });
    expect(detached).toBe('detached 2 tasks from contest 9.');
  });

  it('rotates a contest roster as the root actor, stating the team it set', async () => {
    const line = await runPanelCommand(
      parsePanelCommand(['accounts', 'rotate', '9', '--user', '12,13', '--team', '3', '--reason', 'day two']),
    );

    expect(mocks.rotateContestAccounts).toHaveBeenCalledWith(ROOT_ACTOR, {
      contestId: 9,
      userIds: [12, 13],
      teamId: 3,
      reason: 'day two',
    });
    expect(line).toBe('rotated 2 accounts in contest 9, 2 on team 3.');
  });

  it('files and ends a waiver as the root actor', async () => {
    const filed = await runPanelCommand(
      parsePanelCommand([
        'waiver', 'create', '--source', 'osv', '--match', 'CVE-2026-1234',
        '--review-by', '2027-01-31', '--reason', 'tracked upstream',
      ]),
    );
    expect(mocks.createWaiver).toHaveBeenCalledWith(ROOT_ACTOR, {
      source: 'osv',
      match: 'CVE-2026-1234',
      reviewBy: '2027-01-31',
      reason: 'tracked upstream',
    });
    expect(filed).toBe('waiver 5 filed for osv CVE-2026-1234.');

    const ended = await runPanelCommand(parsePanelCommand(['waiver', 'end', '5', '--reason', 'patched']));
    expect(mocks.endWaiver).toHaveBeenCalledWith(ROOT_ACTOR, 5, 'patched');
    expect(ended).toBe('waiver 5 ended.');
  });

  it('refuses to report success for a waiver the module rejected', async () => {
    // WHY: the waiver writes answer `{ success: false }` — the panel shows that on its form — so a
    // past review date has to stop the command, not print a filed waiver that does not exist.
    mocks.createWaiver.mockResolvedValue({ success: false, error: 'review_by must be a future date' });

    await expect(
      runPanelCommand(
        parsePanelCommand([
          'waiver', 'create', '--source', 'osv', '--match', 'CVE-1',
          '--review-by', '2020-01-01', '--reason', 'x',
        ]),
      ),
    ).rejects.toThrow('review_by must be a future date');
  });

  it('performs nothing when no root actor can be resolved', async () => {
    // A write filed as NULL is the one outcome the actor contract forbids, so an unresolvable
    // actor has to stop the command before any write runs.
    mocks.resolveRootActorId.mockRejectedValue(new Error('no admin named root to attribute this write to'));

    await expect(runPanelCommand(parsePanelCommand(['config', 'show', '9', '--reason', 'x']))).rejects.toThrow(
      'no admin named root',
    );
    expect(mocks.showConfigTarget).not.toHaveBeenCalled();
    expect(mocks.saveService).not.toHaveBeenCalled();
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
