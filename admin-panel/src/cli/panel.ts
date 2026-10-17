import {
  addOverride,
  bindServiceContest,
  endConfigTargets,
  endOverrides,
  resolveRootActorId,
  showConfigTarget,
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
 * WHY the actor is resolved here: the panel's actor is its session, and a script has no session —
 * the seeded `root` admin is the account that owns script-side actions, and the audit trail reads
 * a name rather than NULL (see `resolveRootActorId`).
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
under the \`root\` actor, exactly as the panel files the same action.

Commands:
  registry bind <service> --contest <id|none>
        Point a registry row at the contest its shard serves. 'none' clears it; a row whose role
        must name a contest (ProxyService) is refused by the same check the panel form runs.
  config show <contest-id> --reason <text>
        Put a contest on the ranking board.
  config end <config-id> --reason <text>
        Take a shown target off the board. The row is kept, so its author and reason survive.
  override add --contest <id> --kind <kind> --key <key> --action <action> [--value <text>] --reason <text>
        File a ranking override. --key is the board's encoded handle ('*' for the whole-board
        ranking kind); --value carries the rename/score/pin argument.
  override end <override-id> --reason <text>
        End a ranking override.

Kinds, verbs and targets are the panel's own lists (lib/ranking-override-verbs, lib/ranking-config):
anything outside them is refused here rather than filed as a row the board cannot read.`;

/** The areas the surface is grouped by, mirroring the panel surfaces the writes belong to. */
export type PanelCommand =
  | { readonly area: 'registry'; readonly service: string; readonly contestId: number | null }
  | { readonly area: 'config'; readonly verb: 'show'; readonly contestId: string; readonly reason: string }
  | { readonly area: 'config'; readonly verb: 'end'; readonly configId: string; readonly reason: string }
  | {
      readonly area: 'override';
      readonly verb: 'add';
      readonly contestId: string;
      readonly kind: string;
      readonly key: string;
      readonly action: string;
      readonly value: string;
      readonly reason: string;
    }
  | { readonly area: 'override'; readonly verb: 'end'; readonly overrideId: number; readonly reason: string };

const CONFIG_VERBS = ['show', 'end'] as const;
const OVERRIDE_VERBS = ['add', 'end'] as const;

function isConfigVerb(value: string | undefined): value is (typeof CONFIG_VERBS)[number] {
  return CONFIG_VERBS.some((candidate) => candidate === value);
}

function isOverrideVerb(value: string | undefined): value is (typeof OVERRIDE_VERBS)[number] {
  return OVERRIDE_VERBS.some((candidate) => candidate === value);
}

/**
 * Reads the flags a verb accepts, refusing one it does not.
 *
 * WHY an unknown flag is refused rather than ignored: a misspelt `--reson` would otherwise be
 * dropped and the write would fail later for a reason that names the missing value instead of the
 * typo, which is the kind of message an operator cannot act on.
 */
function readFlags(args: readonly string[], allowed: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      throw new PanelUsageError(`unexpected argument ${JSON.stringify(token)}`);
    }
    const name = token.slice(2);
    if (!allowed.includes(name)) throw new PanelUsageError(`unknown option ${token}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new PanelUsageError(`${token} needs a value`);
    }
    flags[name] = value;
    index += 1;
  }
  return flags;
}

function required(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (value === undefined) throw new PanelUsageError(`--${name} is required`);
  return value;
}

/** The contest a registry row serves: `none` clears the binding, anything else has to be an id. */
function readContestBinding(value: string): number | null {
  if (value.trim() === 'none') return null;
  if (!/^\d+$/.test(value.trim())) {
    throw new PanelUsageError(`--contest takes a contest id or 'none', not ${JSON.stringify(value)}`);
  }
  return Number.parseInt(value.trim(), 10);
}

function readOverrideId(value: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new PanelUsageError(`the override id is a number, not ${JSON.stringify(value)}`);
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
 * Turns argv into one command, or refuses the shape.
 *
 * WHY the domain values (a target kind, a verb, a contest id, a config id) are carried through as
 * text: the shared module owns what each of them may be, so the parser that read them does not
 * grow a second copy of the rule — a kind this build cannot draw is refused by the same code the
 * panel's form reaches.
 */
export function parsePanelCommand(argv: readonly string[]): PanelCommand {
  const [area, verb] = argv;
  if (area === 'registry') {
    if (verb !== 'bind') throw new PanelUsageError(`registry takes 'bind', not ${JSON.stringify(verb)}`);
    const service = positional(argv, 2, 'the service to bind');
    const flags = readFlags(argv.slice(3), ['contest']);
    return { area: 'registry', service, contestId: readContestBinding(required(flags, 'contest')) };
  }
  if (area === 'config') {
    if (!isConfigVerb(verb)) {
      throw new PanelUsageError(`config takes ${CONFIG_VERBS.join(' or ')}, not ${JSON.stringify(verb)}`);
    }
    const target = positional(argv, 2, 'the target id');
    const flags = readFlags(argv.slice(3), ['reason']);
    const reason = required(flags, 'reason');
    return verb === 'show'
      ? { area: 'config', verb, contestId: target, reason }
      : { area: 'config', verb, configId: target, reason };
  }
  if (area === 'override') {
    if (!isOverrideVerb(verb)) {
      throw new PanelUsageError(`override takes ${OVERRIDE_VERBS.join(' or ')}, not ${JSON.stringify(verb)}`);
    }
    if (verb === 'end') {
      const overrideId = positional(argv, 2, 'the override to end');
      const flags = readFlags(argv.slice(3), ['reason']);
      return { area: 'override', verb, overrideId: readOverrideId(overrideId), reason: required(flags, 'reason') };
    }
    const flags = readFlags(argv.slice(2), ['contest', 'kind', 'key', 'value', 'action', 'reason']);
    return {
      area: 'override',
      verb,
      contestId: required(flags, 'contest'),
      kind: required(flags, 'kind'),
      key: flags.key ?? '',
      action: required(flags, 'action'),
      value: flags.value ?? '',
      reason: required(flags, 'reason'),
    };
  }
  throw new PanelUsageError(`unknown area ${JSON.stringify(area)}`);
}

/**
 * Performs one parsed command as the `root` actor and answers the line to print.
 *
 * WHY the actor is resolved before the write: a write that cannot name an actor must not land, and
 * resolving first keeps that true even when the write itself would have succeeded.
 */
export async function runPanelCommand(command: PanelCommand): Promise<string> {
  const actorId = await resolveRootActorId();
  if (command.area === 'registry') {
    await bindServiceContest(actorId, { service: command.service, contestId: command.contestId });
    const served = command.contestId === null ? 'no contest' : `contest ${command.contestId}`;
    return `${command.service} now serves ${served}.`;
  }
  if (command.area === 'config') {
    if (command.verb === 'show') {
      await showConfigTarget(actorId, {
        kind: 'contest',
        targetKey: command.contestId,
        reason: command.reason,
      });
      return `contest ${command.contestId} is now on the board.`;
    }
    // WHY a zero-row end is a refusal: a single id is the whole selection here, so reporting
    // success for a write that matched nothing would be exactly the silent skip this verb exists
    // to avoid — the operator would read "done" and the board would still show the target.
    const ended = await endConfigTargets(actorId, [command.configId], command.reason);
    if (ended === 0) {
      throw new Error(`no active shown target ${command.configId} to end`);
    }
    return `shown target ${command.configId} is off the board.`;
  }
  if (command.verb === 'end') {
    const ended = await endOverrides(actorId, [command.overrideId], command.reason);
    if (ended === 0) {
      throw new Error(`no active override ${command.overrideId} to end`);
    }
    return `override ${command.overrideId} ended.`;
  }
  await addOverride(actorId, {
    contestId: command.contestId,
    targetKind: command.kind,
    targetKey: command.key,
    action: command.action,
    value: command.value,
    reason: command.reason,
  });
  return `override ${command.action} ${command.kind} ${command.key} filed for contest ${command.contestId}.`;
}
