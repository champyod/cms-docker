import {
  addOverride,
  addOverrides,
  attachContestTasks,
  bindServiceContest,
  createWaiver,
  detachContestTasks,
  endConfigTargets,
  endOverrides,
  endWaiver,
  removeExposure,
  removeService,
  removeWiring,
  resolveRootActorId,
  rotateContestAccounts,
  saveExposure,
  saveService,
  saveWiring,
  showConfigTarget,
  type ExposureInput,
  type ServiceInput,
  type ServiceRole,
  type WaiverInput,
  type WiringInput,
  type WriteResult,
} from '@/lib/panel-actions';

/**
 * The `./cms panel` surface: every one of these verbs performs the write itself, in-process,
 * against the same module the panel's server actions wrap.
 *
 * WHY a CLI and not a call to the panel's HTTP: the operator's requirement is that the verb works
 * while no panel process is running, so there is nothing to call but the write itself. WHY the
 * same module and not a second implementation: the panel editor and the verb have to mean the same
 * thing by a binding, a shown contest and an override, and two implementations would drift exactly
 * where a live contest cannot afford them to.
 *
 * WHY every shared write has a verb and not only the ones the operator asked for first: a write
 * that exists only behind a form is a write a script cannot reach, so the panel becomes the only
 * way to perform it — which is the situation `lib/panel-actions` was extracted to end. The list
 * below is therefore the module's write surface, and `PANEL_WRITE_VERBS` beside it says which
 * verb drives which write. `tests/panel-cli-coverage.test.ts` holds the two together: a write
 * exported without a verb fails the suite instead of waiting for an operator to notice.
 *
 * WHY the actor is resolved here: the panel's actor is its session, and a script has no session —
 * the seeded `root` admin is the account that owns script-side actions, and the audit trail reads
 * a name rather than NULL (see `resolveRootActorId`). Only the writes that file an actor resolve
 * it: the registry's row-level writes take no actor at all, so demanding one would refuse a write
 * the panel performs from the same function.
 */

/** A command line the parser cannot read, as opposed to a write the database refuses. */
export class PanelUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PanelUsageError';
  }
}

export const PANEL_USAGE = `usage: cms panel <command> [args]

Every command performs the write itself — the panel does not have to be running — and files it
under the \`root\` actor wherever the write records an actor, exactly as the panel files the same
action.

The registry (roles, pull policies and ports are the panel's own vocabulary):
  registry bind <service> --contest <id|none>
        Point a registry row at the contest its shard serves. 'none' clears it; a row whose role
        must name a contest (ProxyService) is refused by the same check the panel form runs.
  registry service set --name <name> --role <role> --host <host> --db-profile <profile>
                        [--shard <n>] [--http-port <n>] [--rpc-port <n>] [--contest <id|none>]
                        [--image <ref>] [--pull-policy <always|missing|never>] [--disabled]
                        [--id <row>]
        Create a service row, or correct the row --id names. Unstated fields take the panel
        form's own defaults: shard 0, profile 'default', pull policy 'missing', enabled.
  registry service remove <id>
        Delete a service row by id.
  registry wiring set --from <service-id> --to <service-id> --relation <relation>
                      [--disabled] [--id <row>]
        Create a wiring, or correct the one --id names.
  registry wiring remove <id>
  registry exposure set --service <service-id> [--path </path>] [--hostname <host>]
                        [--tailnet <node>] [--no-tls] [--id <row>]
        Create an exposure, or correct the one --id names. An omitted path is the root location.
  registry exposure remove <id>

The board:
  config show <contest-id> --reason <text>
        Put a contest on the ranking board.
  config end <config-id>... --reason <text>
        Take one or more shown targets off the board. The rows are kept, so their author and
        reason survive.
  override add --contest <id> --kind <kind> --action <action> [--value <text>]
               [--key <key>]... --reason <text>
        File a ranking override. One --key files one row; several file the whole selection in one
        write, which is what the panel's bulk surface does. --key is the board's encoded handle
        ('*' for the whole-board ranking kind, where it may be omitted); --value carries the
        rename/score/pin argument.
  override end <override-id>... --reason <text>
        End one or more ranking overrides.

A contest's roster and its accounts:
  contest task attach <contest-id> --task <id>[,<id>...]
        Put tasks on a contest. A task already on it refuses the whole selection.
  contest task detach <contest-id> --task <id>[,<id>...]
        Take tasks off a contest. A task not on it refuses the whole selection.
  contest accounts rotate <contest-id> --user <id>[,<id>...] [--team <id>] --reason <text>
        Rotate the display usernames of the selected accounts and, when --team is given, set that
        team on the same participations — one transaction, as the panel's day-two action runs it.

The patching surface's decisions:
  waiver create --source <diun|rootfs|osv> --match <finding-key|cve> --review-by <date> --reason <text>
        File a waiver for a finding. --review-by is the date the decision is reviewed and must be
        in the future: the contract makes a waiver a decision with a date, and an expiry that has
        already passed would be an approval that was never true.
  waiver end <waiver-id> --reason <text>
        End a waiver. The row keeps its reason and gains the ending time.

Kinds, verbs, roles and targets are the panel's own lists (lib/ranking-override-verbs,
lib/ranking-config, lib/service-wiring-contract, lib/security/patching): anything outside them is
refused here rather than filed as a row the board, the registry or the patching surface cannot
read.`;

/** One command, as the parser read it. Domain values stay text where the shared module owns them. */
export type PanelCommand =
  | { readonly area: 'registry'; readonly verb: 'bind'; readonly service: string; readonly contestId: number | null }
  | { readonly area: 'registry'; readonly verb: 'service-set'; readonly service: ServiceInput }
  | { readonly area: 'registry'; readonly verb: 'service-remove'; readonly id: number }
  | { readonly area: 'registry'; readonly verb: 'wiring-set'; readonly wiring: WiringInput }
  | { readonly area: 'registry'; readonly verb: 'wiring-remove'; readonly id: number }
  | { readonly area: 'registry'; readonly verb: 'exposure-set'; readonly exposure: ExposureInput }
  | { readonly area: 'registry'; readonly verb: 'exposure-remove'; readonly id: number }
  | { readonly area: 'config'; readonly verb: 'show'; readonly contestId: string; readonly reason: string }
  | { readonly area: 'config'; readonly verb: 'end'; readonly configIds: readonly string[]; readonly reason: string }
  | {
      readonly area: 'override';
      readonly verb: 'add';
      readonly contestId: string;
      readonly kind: string;
      readonly keys: readonly string[];
      readonly action: string;
      readonly value: string;
      readonly reason: string;
    }
  | { readonly area: 'override'; readonly verb: 'end'; readonly overrideIds: readonly number[]; readonly reason: string }
  | { readonly area: 'task'; readonly verb: 'attach'; readonly contestId: number; readonly taskIds: readonly number[] }
  | { readonly area: 'task'; readonly verb: 'detach'; readonly contestId: number; readonly taskIds: readonly number[] }
  | {
      readonly area: 'accounts';
      readonly verb: 'rotate';
      readonly contestId: number;
      readonly userIds: readonly number[];
      readonly teamId: number | null;
      readonly reason: string;
    }
  | { readonly area: 'waiver'; readonly verb: 'create'; readonly waiver: WaiverInput }
  | { readonly area: 'waiver'; readonly verb: 'end'; readonly waiverId: number; readonly reason: string };

/**
 * Which verb drives which write of the shared module.
 *
 * WHY this table exists in the source and not only in the suite: it is the CLI's own statement of
 * its coverage, so the guard reads the same list the parser dispatches from and there is no third
 * place for the two to disagree. Every write `lib/panel-actions` publishes appears here once.
 *
 * WHY a write can carry one verb that files several rows: `addOverrides` is the panel's bulk
 * surface, and `override add` with several `--key`s is that same write — one selection, one
 * transaction, one audit row. The verb states the shape, not the row count.
 */
export interface PanelVerbWrite {
  /** The exported write in `lib/panel-actions`, by name. */
  readonly write: string;
  /** The words `cms panel` dispatches on. */
  readonly verb: readonly string[];
}

export const PANEL_WRITE_VERBS: readonly PanelVerbWrite[] = [
  { write: 'bindServiceContest', verb: ['registry', 'bind'] },
  { write: 'saveService', verb: ['registry', 'service', 'set'] },
  { write: 'removeService', verb: ['registry', 'service', 'remove'] },
  { write: 'saveWiring', verb: ['registry', 'wiring', 'set'] },
  { write: 'removeWiring', verb: ['registry', 'wiring', 'remove'] },
  { write: 'saveExposure', verb: ['registry', 'exposure', 'set'] },
  { write: 'removeExposure', verb: ['registry', 'exposure', 'remove'] },
  { write: 'showConfigTarget', verb: ['config', 'show'] },
  { write: 'endConfigTargets', verb: ['config', 'end'] },
  { write: 'addOverride', verb: ['override', 'add'] },
  { write: 'addOverrides', verb: ['override', 'add'] },
  { write: 'endOverrides', verb: ['override', 'end'] },
  { write: 'attachContestTasks', verb: ['task', 'attach'] },
  { write: 'detachContestTasks', verb: ['task', 'detach'] },
  { write: 'rotateContestAccounts', verb: ['accounts', 'rotate'] },
  { write: 'createWaiver', verb: ['waiver', 'create'] },
  { write: 'endWaiver', verb: ['waiver', 'end'] },
];

/**
 * The module's exports that are deliberately not verbs, and why.
 *
 * WHY the reason is required and not a bare list: an export added to `lib/panel-actions` tomorrow
 * is either a write that needs a verb or one of these, and the only way to tell is for the author
 * to say which and why. A bare allowlist would let the next write land here by convenience.
 */
export const PANEL_NON_VERB_EXPORTS: Readonly<Record<string, string>> = {
  validateService:
    'a validator: it refuses a service row and writes nothing, so the write it guards is the verb',
  validateExposure:
    'a validator: it refuses an exposure row and writes nothing, so the write it guards is the verb',
  writeContestUsername:
    'one row inside a caller-run transaction — `accounts rotate` is the verb that opens it',
  assignTeamToParticipants:
    'one statement inside a caller-run transaction — `accounts rotate` is the verb that opens it',
  attachContestTask:
    'one row inside a caller-run transaction — `task attach` is the verb that opens it',
  detachContestTask:
    'one row inside a caller-run transaction — `task detach` is the verb that opens it',
  resolveRootActorId:
    'the actor the verbs file under, not a write: it changes no row',
};

const CONFIG_VERBS = ['show', 'end'] as const;
const OVERRIDE_VERBS = ['add', 'end'] as const;
const REGISTRY_ROW_VERBS = ['set', 'remove'] as const;
const TASK_VERBS = ['attach', 'detach'] as const;

/** The three collections the registry screen edits, as `registry <kind> set|remove` names them. */
type RegistryRowKind = 'service' | 'wiring' | 'exposure';

function isConfigVerb(value: string | undefined): value is (typeof CONFIG_VERBS)[number] {
  return CONFIG_VERBS.some((candidate) => candidate === value);
}

function isOverrideVerb(value: string | undefined): value is (typeof OVERRIDE_VERBS)[number] {
  return OVERRIDE_VERBS.some((candidate) => candidate === value);
}

function isRegistryRowKind(value: string | undefined): value is RegistryRowKind {
  return value === 'service' || value === 'wiring' || value === 'exposure';
}

function isRegistryRowVerb(value: string | undefined): value is (typeof REGISTRY_ROW_VERBS)[number] {
  return REGISTRY_ROW_VERBS.some((candidate) => candidate === value);
}

function isTaskVerb(value: string | undefined): value is (typeof TASK_VERBS)[number] {
  return TASK_VERBS.some((candidate) => candidate === value);
}

/** Which flags a verb accepts, and which of them take no value. */
interface FlagSpec {
  readonly values?: readonly string[];
  /** Flags that are present or absent, never valued — `--disabled`, `--no-tls`. */
  readonly switches?: readonly string[];
}

interface Flags {
  /** Every value a valued flag was given, in order: a repeated `--key` is a selection. */
  readonly values: ReadonlyMap<string, readonly string[]>;
  readonly switches: ReadonlySet<string>;
}

/**
 * Reads the flags a verb accepts, refusing one it does not.
 *
 * WHY an unknown flag is refused rather than ignored: a misspelt `--reson` would otherwise be
 * dropped and the write would fail later for a reason that names the missing value instead of the
 * typo, which is the kind of message an operator cannot act on.
 *
 * WHY a repeated flag is kept rather than overwritten: `--key` and `--task` name a selection, and
 * the write they drive files the whole selection or none of it, so silently keeping the last one
 * would perform a different write than the caller typed.
 */
function readFlags(args: readonly string[], spec: FlagSpec): Flags {
  const values = new Map<string, string[]>();
  const switches = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      throw new PanelUsageError(`unexpected argument ${JSON.stringify(token)}`);
    }
    const name = token.slice(2);
    if (spec.switches?.includes(name)) {
      switches.add(name);
      continue;
    }
    if (!spec.values?.includes(name)) throw new PanelUsageError(`unknown option ${token}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new PanelUsageError(`${token} needs a value`);
    }
    const seen = values.get(name);
    if (seen === undefined) values.set(name, [value]);
    else seen.push(value);
    index += 1;
  }
  return { values, switches };
}

/** The last value given for a flag, or undefined when it was not given. */
function one(flags: Flags, name: string): string | undefined {
  const values = flags.values.get(name);
  return values === undefined ? undefined : values[values.length - 1];
}

function required(flags: Flags, name: string): string {
  const value = one(flags, name);
  if (value === undefined) throw new PanelUsageError(`--${name} is required`);
  return value;
}

/**
 * Every value given for a flag, split on commas, so `--task 4,5` and `--task 4 --task 5` are the
 * same selection. Blank entries are dropped here and an empty result is left for the write to
 * refuse, which is where the "select at least one" wording lives.
 */
function many(flags: Flags, name: string): string[] {
  const raw = flags.values.get(name) ?? [];
  return raw.flatMap((value) => value.split(',').map((part) => part.trim())).filter((part) => part !== '');
}

/** A numeric argument, refused with the label the operator typed rather than a cast. */
function readIntText(value: string, label: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new PanelUsageError(`${label} is a number, not ${JSON.stringify(value)}`);
  }
  return Number.parseInt(value.trim(), 10);
}

function readRequiredInt(flags: Flags, name: string, label: string): number {
  return readIntText(required(flags, name), label);
}

function readOptionalInt(flags: Flags, name: string, label: string): number | null {
  const value = one(flags, name);
  return value === undefined ? null : readIntText(value, label);
}

/** The contest a registry row serves: `none` clears the binding, anything else has to be an id. */
function readContestBinding(value: string): number | null {
  if (value.trim() === 'none') return null;
  if (!/^\d+$/.test(value.trim())) {
    throw new PanelUsageError(`--contest takes a contest id or 'none', not ${JSON.stringify(value)}`);
  }
  return Number.parseInt(value.trim(), 10);
}

/** A positional argument the caller did not supply. */
function positional(args: readonly string[], index: number, label: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) {
    throw new PanelUsageError(`missing ${label}`);
  }
  return value;
}

/**
 * The leading positionals a verb takes, up to its first flag.
 *
 * WHY the split rather than "positionals at fixed indexes": `config end` and `override end` take a
 * selection of ids, so the count is the caller's, and the flags that follow are read from where the
 * positionals stop.
 */
function splitPositionals(args: readonly string[]): { positionals: string[]; flags: string[] } {
  const index = args.findIndex((token) => token.startsWith('--'));
  if (index === -1) return { positionals: [...args], flags: [] };
  return { positionals: args.slice(0, index), flags: args.slice(index) };
}

/**
 * One row of the registry, as the panel's own editor collects it.
 *
 * WHY the defaults are the form's: `registry service set` with only the four required fields has to
 * write the row a `+ add service` would write, or the verb and the form would create two different
 * starting rows for the same registry.
 */
function parseServiceSet(args: readonly string[]): ServiceInput {
  const flags = readFlags(args, {
    values: ['id', 'name', 'role', 'shard', 'host', 'http-port', 'rpc-port', 'db-profile', 'image', 'pull-policy', 'contest'],
    switches: ['disabled'],
  });
  const contest = one(flags, 'contest');
  return {
    id: readOptionalInt(flags, 'id', 'the row id') ?? undefined,
    name: required(flags, 'name'),
    // WHY the role is a cast into a typed field: SERVICE_ROLES is the vocabulary and
    // `validateService` refuses a role outside it with the message the panel's form shows, so a
    // second check here would be a second copy of one rule.
    role: required(flags, 'role') as ServiceRole,
    shard: readOptionalInt(flags, 'shard', 'the shard') ?? 0,
    host: required(flags, 'host'),
    http_port: readOptionalInt(flags, 'http-port', 'the http port'),
    rpc_port: readOptionalInt(flags, 'rpc-port', 'the rpc port'),
    db_profile: one(flags, 'db-profile') ?? 'default',
    contest_id: contest === undefined ? null : readContestBinding(contest),
    enabled: !flags.switches.has('disabled'),
    image: one(flags, 'image') ?? '',
    pull_policy: one(flags, 'pull-policy') ?? 'missing',
  };
}

function parseWiringSet(args: readonly string[]): WiringInput {
  const flags = readFlags(args, {
    values: ['id', 'from', 'to', 'relation'],
    switches: ['disabled'],
  });
  return {
    id: readOptionalInt(flags, 'id', 'the row id') ?? undefined,
    from_service_id: readRequiredInt(flags, 'from', 'the service the wiring leaves'),
    to_service_id: readRequiredInt(flags, 'to', 'the service the wiring reaches'),
    relation: required(flags, 'relation'),
    enabled: !flags.switches.has('disabled'),
  };
}

function parseExposureSet(args: readonly string[]): ExposureInput {
  const flags = readFlags(args, {
    values: ['id', 'service', 'hostname', 'path', 'tailnet'],
    switches: ['no-tls'],
  });
  return {
    id: readOptionalInt(flags, 'id', 'the row id') ?? undefined,
    service_id: readRequiredInt(flags, 'service', 'the service the exposure fronts'),
    hostname: one(flags, 'hostname') ?? '',
    // WHY the root location when no path is given: the panel's blank draft starts at '/', and an
    // exposure with no path is the root one — stated here so the omission means that, not nothing.
    path: one(flags, 'path') ?? '/',
    tls: !flags.switches.has('no-tls'),
    tailnet: one(flags, 'tailnet') ?? null,
  };
}

/**
 * Turns argv into one command, or refuses the shape.
 *
 * WHY the domain values (a target kind, a verb, a contest id, a config id) are carried through as
 * text: the shared module owns what each of them may be, so the parser that read them does not
 * grow a second copy of the rule — a kind this build cannot draw is refused by the same code the
 * panel's form reaches.
 */
export function parsePanelCommand(argv: readonly string[]): PanelCommand {
  const [area, verb, third] = argv;
  if (area === 'registry') {
    if (verb === 'bind') {
      const service = positional(argv, 2, 'the service to bind');
      const flags = readFlags(argv.slice(3), { values: ['contest'] });
      return { area: 'registry', verb, service, contestId: readContestBinding(required(flags, 'contest')) };
    }
    if (isRegistryRowKind(verb)) {
      if (!isRegistryRowVerb(third)) {
        throw new PanelUsageError(
          `registry ${verb} takes ${REGISTRY_ROW_VERBS.join(' or ')}, not ${JSON.stringify(third)}`,
        );
      }
      if (third === 'remove') {
        const id = positional(argv, 3, `the ${verb} row to remove`);
        readFlags(argv.slice(4), {});
        const rowId = readIntText(id, `the ${verb} row id`);
        if (verb === 'service') return { area: 'registry', verb: 'service-remove', id: rowId };
        if (verb === 'wiring') return { area: 'registry', verb: 'wiring-remove', id: rowId };
        return { area: 'registry', verb: 'exposure-remove', id: rowId };
      }
      // WHY slice(3) for a `set`: the words are `<area> <kind> set`, so the flags start at the
      // fourth token — a removal has already consumed its id by then and starts at the fifth.
      if (verb === 'service') return { area: 'registry', verb: 'service-set', service: parseServiceSet(argv.slice(3)) };
      if (verb === 'wiring') return { area: 'registry', verb: 'wiring-set', wiring: parseWiringSet(argv.slice(3)) };
      return { area: 'registry', verb: 'exposure-set', exposure: parseExposureSet(argv.slice(3)) };
    }
    throw new PanelUsageError(
      `registry takes bind, service, wiring or exposure, not ${JSON.stringify(verb)}`,
    );
  }
  if (area === 'config') {
    if (!isConfigVerb(verb)) {
      throw new PanelUsageError(`config takes ${CONFIG_VERBS.join(' or ')}, not ${JSON.stringify(verb)}`);
    }
    const split = splitPositionals(argv.slice(2));
    const flags = readFlags(split.flags, { values: ['reason'] });
    const reason = required(flags, 'reason');
    const targets = split.positionals;
    if (targets.length === 0) throw new PanelUsageError('missing the target id');
    if (verb === 'show') return { area: 'config', verb, contestId: targets[0], reason };
    return { area: 'config', verb, configIds: targets, reason };
  }
  if (area === 'override') {
    if (!isOverrideVerb(verb)) {
      throw new PanelUsageError(`override takes ${OVERRIDE_VERBS.join(' or ')}, not ${JSON.stringify(verb)}`);
    }
    if (verb === 'end') {
      const split = splitPositionals(argv.slice(2));
      const flags = readFlags(split.flags, { values: ['reason'] });
      if (split.positionals.length === 0) throw new PanelUsageError('missing the override to end');
      return {
        area: 'override',
        verb,
        overrideIds: split.positionals.map((value) => readIntText(value, 'the override id')),
        reason: required(flags, 'reason'),
      };
    }
    const flags = readFlags(argv.slice(2), {
      values: ['contest', 'kind', 'key', 'value', 'action', 'reason'],
    });
    const keys = many(flags, 'key');
    return {
      area: 'override',
      verb,
      contestId: required(flags, 'contest'),
      kind: required(flags, 'kind'),
      // WHY one empty key rather than none: the whole-board kind carries no target text, and the
      // shared write states that wildcard itself — so an omitted --key is the single row it always
      // was, not an empty selection the write would then have to special-case.
      keys: keys.length === 0 ? [''] : keys,
      action: required(flags, 'action'),
      value: one(flags, 'value') ?? '',
      reason: required(flags, 'reason'),
    };
  }
  if (area === 'task') {
    if (!isTaskVerb(verb)) {
      throw new PanelUsageError(`task takes ${TASK_VERBS.join(' or ')}, not ${JSON.stringify(verb)}`);
    }
    const contestId = readIntText(positional(argv, 2, 'the contest'), 'the contest id');
    const flags = readFlags(argv.slice(3), { values: ['task'] });
    return { area: 'task', verb, contestId, taskIds: many(flags, 'task').map((value) => readIntText(value, 'a task id')) };
  }
  if (area === 'accounts') {
    if (verb !== 'rotate') {
      throw new PanelUsageError(`accounts takes rotate, not ${JSON.stringify(verb)}`);
    }
    const contestId = readIntText(positional(argv, 2, 'the contest'), 'the contest id');
    const flags = readFlags(argv.slice(3), { values: ['user', 'team', 'reason'] });
    return {
      area: 'accounts',
      verb,
      contestId,
      userIds: many(flags, 'user').map((value) => readIntText(value, 'an account id')),
      teamId: readOptionalInt(flags, 'team', 'the team id'),
      reason: required(flags, 'reason'),
    };
  }
  if (area === 'waiver') {
    if (verb === 'end') {
      const waiverId = readIntText(positional(argv, 2, 'the waiver to end'), 'the waiver id');
      const flags = readFlags(argv.slice(3), { values: ['reason'] });
      return { area: 'waiver', verb, waiverId, reason: required(flags, 'reason') };
    }
    if (verb !== 'create') {
      throw new PanelUsageError(`waiver takes create or end, not ${JSON.stringify(verb)}`);
    }
    const flags = readFlags(argv.slice(2), { values: ['source', 'match', 'review-by', 'reason'] });
    return {
      area: 'waiver',
      verb,
      waiver: {
        source: required(flags, 'source'),
        match: required(flags, 'match'),
        // WHY the date rides through as text: `createWaiver` owns what a review date may be — a
        // future-only decision — and parses it once for both boundaries.
        reviewBy: required(flags, 'review-by'),
        reason: required(flags, 'reason'),
      },
    };
  }
  throw new PanelUsageError(`unknown area ${JSON.stringify(area)}`);
}

/**
 * Turns the shared module's tri-state result into a refusal.
 *
 * WHY: the registry's row-level writes answer `{ success: false, error }` rather than throwing —
 * the panel renders that on the form — so a CLI that printed its success line regardless would
 * report a write the database refused, and exit zero over it.
 */
function requireWritten(result: WriteResult, subject: string): void {
  if (result.success === true) return;
  throw new Error(result.error ?? `${subject} was refused`);
}

/** A count with its noun, so a one-row write does not print as "1 tasks". */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Performs one parsed command as the `root` actor and answers the line to print.
 *
 * WHY the actor is resolved before the write: a write that cannot name an actor must not land, and
 * resolving first keeps that true even when the write itself would have succeeded. It is resolved
 * per command rather than once up front because the registry's row-level writes take no actor —
 * refusing them for a missing `root` admin would refuse a write the panel performs.
 */
export async function runPanelCommand(command: PanelCommand): Promise<string> {
  if (command.area === 'registry') {
    if (command.verb === 'bind') {
      const actorId = await resolveRootActorId();
      await bindServiceContest(actorId, { service: command.service, contestId: command.contestId });
      const served = command.contestId === null ? 'no contest' : `contest ${command.contestId}`;
      return `${command.service} now serves ${served}.`;
    }
    if (command.verb === 'service-set') {
      const actorId = await resolveRootActorId();
      const { id, name } = command.service;
      requireWritten(await saveService(actorId, command.service), `saving service ${name}`);
      return id === undefined ? `service ${name} added to the registry.` : `service ${name} (row ${id}) saved.`;
    }
    if (command.verb === 'service-remove') {
      requireWritten(await removeService(command.id), `removing service row ${command.id}`);
      return `service row ${command.id} removed.`;
    }
    if (command.verb === 'wiring-set') {
      const { id, from_service_id: from, to_service_id: to, relation } = command.wiring;
      requireWritten(await saveWiring(command.wiring), `saving wiring ${from}->${to}`);
      const rows = id === undefined ? '' : ` (row ${id})`;
      return `wiring ${from}->${to} ${relation}${rows} saved.`;
    }
    if (command.verb === 'wiring-remove') {
      requireWritten(await removeWiring(command.id), `removing wiring row ${command.id}`);
      return `wiring row ${command.id} removed.`;
    }
    if (command.verb === 'exposure-set') {
      const { id, service_id: serviceId, path } = command.exposure;
      requireWritten(await saveExposure(command.exposure), `saving the exposure on ${path}`);
      const rows = id === undefined ? '' : ` (row ${id})`;
      return `exposure ${path} on service ${serviceId}${rows} saved.`;
    }
    requireWritten(await removeExposure(command.id), `removing exposure row ${command.id}`);
    return `exposure row ${command.id} removed.`;
  }
  if (command.area === 'config') {
    const actorId = await resolveRootActorId();
    if (command.verb === 'show') {
      await showConfigTarget(actorId, { kind: 'contest', targetKey: command.contestId, reason: command.reason });
      return `contest ${command.contestId} is now on the board.`;
    }
    // WHY a zero-row end is a refusal: a single id is the whole selection here, so reporting
    // success for a write that matched nothing would be exactly the silent skip this verb exists
    // to avoid — the operator would read "done" and the board would still show the target.
    const ended = await endConfigTargets(actorId, command.configIds, command.reason);
    if (ended === 0) {
      throw new Error(`no active shown target ${command.configIds.join(', ')} to end`);
    }
    return command.configIds.length === 1
      ? `shown target ${command.configIds[0]} is off the board.`
      : `shown targets ${command.configIds.join(', ')} are off the board.`;
  }
  if (command.area === 'override') {
    const actorId = await resolveRootActorId();
    if (command.verb === 'end') {
      const ended = await endOverrides(actorId, command.overrideIds, command.reason);
      if (ended === 0) {
        throw new Error(`no active override ${command.overrideIds.join(', ')} to end`);
      }
      return command.overrideIds.length === 1
        ? `override ${command.overrideIds[0]} ended.`
        : `overrides ${command.overrideIds.join(', ')} ended.`;
    }
    const base = {
      contestId: command.contestId,
      targetKind: command.kind,
      action: command.action,
      value: command.value,
      reason: command.reason,
    };
    const keys = command.keys;
    if (keys.length === 1) {
      await addOverride(actorId, { ...base, targetKey: keys[0] });
      return `override ${command.action} ${command.kind} ${keys[0]} filed for contest ${command.contestId}.`;
    }
    const filed = await addOverrides(
      actorId,
      keys.map((key) => ({ ...base, targetKey: key })),
    );
    return `${filed} overrides ${command.action} ${command.kind} filed for contest ${command.contestId}.`;
  }
  if (command.area === 'task') {
    const actorId = await resolveRootActorId();
    const selection = { contestId: command.contestId, taskIds: command.taskIds };
    if (command.verb === 'attach') {
      const attached = await attachContestTasks(actorId, selection);
      return `attached ${counted(attached, 'task')} to contest ${command.contestId}.`;
    }
    const detached = await detachContestTasks(actorId, selection);
    return `detached ${counted(detached, 'task')} from contest ${command.contestId}.`;
  }
  const actorId = await resolveRootActorId();
  if (command.area === 'waiver') {
    if (command.verb === 'create') {
      const result = await createWaiver(actorId, command.waiver);
      requireWritten(result, `filing the waiver for ${command.waiver.source} ${command.waiver.match}`);
      const filed = result.id === undefined ? 'waiver filed' : `waiver ${result.id} filed`;
      return `${filed} for ${command.waiver.source} ${command.waiver.match}.`;
    }
    const result = await endWaiver(actorId, command.waiverId, command.reason);
    requireWritten(result, `ending waiver ${command.waiverId}`);
    return `waiver ${command.waiverId} ended.`;
  }
  const rotated = await rotateContestAccounts(actorId, {
    contestId: command.contestId,
    userIds: command.userIds,
    teamId: command.teamId,
    reason: command.reason,
  });
  const team = command.teamId === null ? '' : `, ${rotated.assigned} on team ${command.teamId}`;
  return `rotated ${rotated.rotated} accounts in contest ${command.contestId}${team}.`;
}
