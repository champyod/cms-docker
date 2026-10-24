import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The guard: every write the shared module publishes has a `cms panel` verb.
 *
 * WHY a guard and not a convention: `lib/panel-actions` grew its second half — the bulk override,
 * the task roster, the day-two rotation — without the CLI growing beside it, and nothing failed.
 * A write reachable only behind a form is a write a script cannot perform, which is the situation
 * the module was extracted to end, so the suite has to notice the gap on the commit that makes it.
 *
 * WHY the classification is read out of the source rather than from the module's runtime exports:
 * "is this a write?" is not answerable from a function's shape. `PANEL_NON_VERB_EXPORTS` makes the
 * author of a new export say which it is and why, and this file refuses to let a name through
 * unstated. The behavioural half then proves the verb really reaches the write it claims.
 */

const PANEL_ACTIONS_INDEX = 'src/lib/panel-actions/index.ts';
const CLI_SOURCE = 'src/cli/panel.ts';

const ACTOR = 11;

// WHY the spy list is written out and then checked against the module's exports: the CLI is
// asserted to reach the real write for each verb, so every export has to be a spy here. The
// last test holds this list to `index.ts`, so it cannot go stale in the silent direction.
const mocks = vi.hoisted(() => {
  const names = [
    'addOverride',
    'addOverrides',
    'assignTeamToParticipants',
    'attachContestTask',
    'attachContestTasks',
    'bindServiceContest',
    'createWaiver',
    'detachContestTask',
    'detachContestTasks',
    'endConfigTargets',
    'endOverrides',
    'endWaiver',
    'removeExposure',
    'removeService',
    'removeWiring',
    'resolveRootActorId',
    'rotateContestAccounts',
    'saveExposure',
    'saveService',
    'saveWiring',
    'showConfigTarget',
    'validateExposure',
    'validateService',
    'writeContestUsername',
  ];
  const spies: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of names) spies[name] = vi.fn();
  return spies;
});

vi.mock('@/lib/panel-actions', () => mocks);

import {
  PANEL_NON_VERB_EXPORTS,
  PANEL_USAGE,
  PANEL_WRITE_VERBS,
  parsePanelCommand,
  runPanelCommand,
} from '@/cli/panel';

/**
 * The names `lib/panel-actions/index.ts` publishes as values.
 *
 * WHY a text read and not `Object.keys`: the module re-exports types beside its functions, and a
 * type has no runtime key — so a runtime read would answer "fewer exports than it has" and let a
 * write-only-in-types slip by. The export blocks are explicit, so the text is the honest list.
 */
function exportedWrites(source: string): string[] {
  const names: string[] = [];
  for (const [, typeOnly, body] of source.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
    // WHY a `export type { … }` block is skipped whole: it publishes input shapes, never a write.
    if (typeOnly !== undefined) continue;
    for (const entry of body.split(',')) {
      const name = entry.trim();
      if (name === '' || name.startsWith('type ')) continue;
      names.push(name.replace(/^.*\sas\s+/, '').trim());
    }
  }
  return names;
}

/** The identifiers the CLI imports from the shared module, so dispatch and table stay one list. */
function importedWrites(source: string): string[] {
  const block = /import\s*\{([^}]*)\}\s*from\s*'@\/lib\/panel-actions'/.exec(source);
  if (block === null) return [];
  return block[1]
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && !entry.startsWith('type '));
}

const BIND_ARGS = { service: 'cms-proxy-1', contestId: 9 };

const SERVICE_ROW = {
  id: undefined,
  name: 'cms-worker-3',
  role: 'Worker',
  shard: 0,
  host: 'cms-worker-3',
  http_port: 6061,
  rpc_port: null,
  db_profile: 'default',
  contest_id: null,
  enabled: true,
  image: '',
  pull_policy: 'missing',
};

const WIRING_ROW = {
  id: undefined,
  from_service_id: 1,
  to_service_id: 2,
  relation: 'drains',
  enabled: true,
};

const EXPOSURE_ROW = {
  id: undefined,
  service_id: 1,
  hostname: '',
  path: '/beta',
  tls: true,
  tailnet: null,
};

const OVERRIDE = {
  contestId: '9',
  targetKind: 'task',
  action: 'hide',
  value: '',
  reason: 'withdrawn',
};

interface Sample {
  /** The verb as `PANEL_WRITE_VERBS` spells it. */
  readonly verb: string;
  /** The export the verb must reach. */
  readonly write: string;
  readonly argv: readonly string[];
  /** The arguments the write must receive, as the CLI's own hand-off. */
  readonly args: readonly unknown[];
}

const SAMPLES: readonly Sample[] = [
  { verb: 'registry bind', write: 'bindServiceContest', argv: ['registry', 'bind', 'cms-proxy-1', '--contest', '9'], args: [ACTOR, BIND_ARGS] },
  {
    verb: 'registry service set',
    write: 'saveService',
    argv: ['registry', 'service', 'set', '--name', 'cms-worker-3', '--role', 'Worker', '--host', 'cms-worker-3', '--http-port', '6061'],
    args: [ACTOR, SERVICE_ROW],
  },
  { verb: 'registry service remove', write: 'removeService', argv: ['registry', 'service', 'remove', '7'], args: [7] },
  {
    verb: 'registry wiring set',
    write: 'saveWiring',
    argv: ['registry', 'wiring', 'set', '--from', '1', '--to', '2', '--relation', 'drains'],
    args: [WIRING_ROW],
  },
  { verb: 'registry wiring remove', write: 'removeWiring', argv: ['registry', 'wiring', 'remove', '3'], args: [3] },
  {
    verb: 'registry exposure set',
    write: 'saveExposure',
    argv: ['registry', 'exposure', 'set', '--service', '1', '--path', '/beta'],
    args: [EXPOSURE_ROW],
  },
  { verb: 'registry exposure remove', write: 'removeExposure', argv: ['registry', 'exposure', 'remove', '5'], args: [5] },
  {
    verb: 'config show',
    write: 'showConfigTarget',
    argv: ['config', 'show', '9', '--reason', 'day two goes live'],
    args: [ACTOR, { kind: 'contest', targetKey: '9', reason: 'day two goes live' }],
  },
  { verb: 'config end', write: 'endConfigTargets', argv: ['config', 'end', '4', '--reason', 'over'], args: [ACTOR, ['4'], 'over'] },
  {
    verb: 'override add',
    write: 'addOverride',
    argv: ['override', 'add', '--contest', '9', '--kind', 'task', '--key', 'Day_1/A', '--action', 'hide', '--reason', 'withdrawn'],
    args: [ACTOR, { ...OVERRIDE, targetKey: 'Day_1/A' }],
  },
  {
    verb: 'override add',
    write: 'addOverrides',
    argv: [
      'override', 'add', '--contest', '9', '--kind', 'task', '--key', 'Day_1/A', '--key', 'Day_1/B',
      '--action', 'hide', '--reason', 'withdrawn',
    ],
    args: [ACTOR, [{ ...OVERRIDE, targetKey: 'Day_1/A' }, { ...OVERRIDE, targetKey: 'Day_1/B' }]],
  },
  { verb: 'override end', write: 'endOverrides', argv: ['override', 'end', '12', '--reason', 'mistake'], args: [ACTOR, [12], 'mistake'] },
  {
    verb: 'task attach',
    write: 'attachContestTasks',
    argv: ['task', 'attach', '9', '--task', '4,5'],
    args: [ACTOR, { contestId: 9, taskIds: [4, 5] }],
  },
  {
    verb: 'task detach',
    write: 'detachContestTasks',
    argv: ['task', 'detach', '9', '--task', '4'],
    args: [ACTOR, { contestId: 9, taskIds: [4] }],
  },
  {
    verb: 'accounts rotate',
    write: 'rotateContestAccounts',
    argv: ['accounts', 'rotate', '9', '--user', '12,13', '--team', '3', '--reason', 'day two'],
    args: [ACTOR, { contestId: 9, userIds: [12, 13], teamId: 3, reason: 'day two' }],
  },
  {
    verb: 'waiver create',
    write: 'createWaiver',
    argv: [
      'waiver', 'create', '--source', 'osv', '--match', 'CVE-2026-1234',
      '--review-by', '2027-01-31', '--reason', 'tracked upstream',
    ],
    args: [ACTOR, { source: 'osv', match: 'CVE-2026-1234', reviewBy: '2027-01-31', reason: 'tracked upstream' }],
  },
  {
    verb: 'waiver end',
    write: 'endWaiver',
    argv: ['waiver', 'end', '5', '--reason', 'patched'],
    args: [ACTOR, 5, 'patched'],
  },
];

const INDEX_SOURCE = readFileSync(PANEL_ACTIONS_INDEX, 'utf8');
const CLI_TEXT = readFileSync(CLI_SOURCE, 'utf8');
const EXPORTS = exportedWrites(INDEX_SOURCE);
const VERB_WRITES = new Set(PANEL_WRITE_VERBS.map((row) => row.write));

function resetSpies(): void {
  vi.clearAllMocks();
  for (const spy of Object.values(mocks)) spy.mockResolvedValue(undefined);
  mocks.resolveRootActorId.mockResolvedValue(ACTOR);
  mocks.saveService.mockResolvedValue({ success: true });
  mocks.removeService.mockResolvedValue({ success: true });
  mocks.saveWiring.mockResolvedValue({ success: true });
  mocks.removeWiring.mockResolvedValue({ success: true });
  mocks.saveExposure.mockResolvedValue({ success: true });
  mocks.removeExposure.mockResolvedValue({ success: true });
  mocks.endConfigTargets.mockResolvedValue(1);
  mocks.endOverrides.mockResolvedValue(1);
  mocks.addOverrides.mockResolvedValue(2);
  mocks.attachContestTasks.mockResolvedValue(2);
  mocks.detachContestTasks.mockResolvedValue(2);
  mocks.rotateContestAccounts.mockResolvedValue({ rotated: 2, assigned: 2 });
  mocks.createWaiver.mockResolvedValue({ success: true, id: 5 });
  mocks.endWaiver.mockResolvedValue({ success: true, id: 5 });
}

beforeEach(resetSpies);

describe('every shared panel write has a CLI verb', () => {
  it('classifies each export of the shared module as a verb or a stated exception', () => {
    const unclassified = EXPORTS.filter(
      (name) => !VERB_WRITES.has(name) && PANEL_NON_VERB_EXPORTS[name] === undefined,
    );
    // WHY this is the guard: a write added to `lib/panel-actions` and not to `PANEL_WRITE_VERBS`
    // appears here, named, instead of shipping as a write only the panel can perform.
    expect(unclassified).toEqual([]);
  });

  it('does not classify anything twice', () => {
    const both = EXPORTS.filter((name) => VERB_WRITES.has(name) && PANEL_NON_VERB_EXPORTS[name] !== undefined);
    expect(both).toEqual([]);
  });

  it('classifies no name the module does not export', () => {
    // WHY: a rename in the module would otherwise leave a table row pointing at a write that no
    // longer exists, and the guard would keep passing about a function nothing can call.
    const stated = [...VERB_WRITES, ...Object.keys(PANEL_NON_VERB_EXPORTS)];
    expect(stated.filter((name) => !EXPORTS.includes(name))).toEqual([]);
  });

  it('routes every verb it states to the write it names', async () => {
    for (const sample of SAMPLES) {
      resetSpies();

      await runPanelCommand(parsePanelCommand(sample.argv));

      expect(
        mocks[sample.write].mock.calls,
        `${sample.verb} must file through ${sample.write}`,
      ).toEqual([sample.args]);
    }
  });

  it('gives every verb in the table a sample that exercises it', () => {
    // WHY both directions: a verb with no sample would be a verb this guard never runs, and a
    // sample for a verb the table does not state would be a test of something nothing declares.
    const declared = new Set(PANEL_WRITE_VERBS.map((row) => row.verb.join(' ')));
    const sampled = new Set(SAMPLES.map((sample) => sample.verb));
    expect([...declared].filter((verb) => !sampled.has(verb))).toEqual([]);
    expect([...sampled].filter((verb) => !declared.has(verb))).toEqual([]);
  });

  it('gives every write in the table a verb that files it', () => {
    const sampled = new Set(SAMPLES.map((sample) => sample.write));
    expect([...VERB_WRITES].filter((write) => !sampled.has(write))).toEqual([]);
  });

  it('names every verb in the usage it prints', () => {
    const unlisted = [...new Set(PANEL_WRITE_VERBS.map((row) => row.verb.join(' ')))].filter(
      (verb) => !PANEL_USAGE.includes(verb),
    );
    expect(unlisted).toEqual([]);
  });

  it('imports no write the table does not state', () => {
    // WHY: the parser can only dispatch what it imports, and the table is the CLI's statement of
    // its coverage — so an import outside the table is a verb whose write nothing declares.
    const undeclared = importedWrites(CLI_TEXT).filter(
      (name) => !VERB_WRITES.has(name) && name !== 'resolveRootActorId',
    );
    expect(undeclared).toEqual([]);
  });

  it('spies on exactly the exports the module publishes', () => {
    expect(Object.keys(mocks).sort()).toEqual([...EXPORTS].sort());
  });
});
