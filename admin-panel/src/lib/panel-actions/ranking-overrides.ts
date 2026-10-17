import { recordAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import {
  KIND_VERBS,
  OVERRIDE_ACTIONS,
  OVERRIDE_TARGETS,
  type OverrideAction,
  type OverrideTarget,
} from '@/lib/ranking-override-verbs';

/**
 * The writes behind the ranking overrides: the exceptions that win over the board's config.
 *
 * WHY one module for both boundaries: the override form and `./cms panel override` have to file
 * and end the same rows, so the vocabulary check, the payload shape and the audit row belong to
 * one implementation. Nothing here reads a request, so the CLI runs it in-process with no panel
 * server up.
 *
 * WHY the bulk add and the single add share one normaliser: the panel's bulk surface files the
 * same row for several targets at once, and a second copy of the vocabulary rules would let the
 * batch accept a target the single form rejects — the two boundaries would then disagree about
 * what an override may be. `addOverride` and `addOverrides` therefore read their input through the
 * one function below.
 */

/** One override as either boundary states it, before it is filed. */
export interface OverrideInput {
  readonly contestId: string;
  readonly targetKind: string;
  readonly targetKey: string;
  readonly action: string;
  readonly value: string;
  readonly reason: string;
}

/** One override once the vocabulary and shape rules have been applied. */
interface NormalisedOverride {
  readonly contestId: number;
  readonly targetKind: OverrideTarget;
  readonly targetKey: string;
  readonly action: OverrideAction;
  readonly value: string;
  readonly reason: string;
}

function readAction(raw: string): OverrideAction {
  const found = OVERRIDE_ACTIONS.find((candidate) => candidate === raw.trim());
  if (found === undefined) throw new Error(`unknown override action: ${raw.trim()}`);
  return found;
}

function readTargetKind(raw: string): OverrideTarget {
  const found = OVERRIDE_TARGETS.find((candidate) => candidate === raw.trim());
  if (found === undefined) throw new Error(`unknown override target: ${raw.trim()}`);
  return found;
}

/**
 * Reads one override into the shape the table stores, refusing anything the vocabulary cannot mean.
 *
 * WHY the contest is required and parsed here: an override scopes its exception to one contest the
 * board draws, so a row naming a contest that is not an id is a scope that never matches — refused
 * before the caller has anything to write. WHY the whole-board kind takes a wildcard key: the
 * `ranking` target is not a row of the board, so it carries `*` and needs no target text.
 */
function normaliseOverrideInput(input: OverrideInput): NormalisedOverride {
  const contestId = input.contestId.trim();
  if (!/^\d+$/.test(contestId)) {
    throw new Error(`an override needs the contest it is scoped to, not ${JSON.stringify(input.contestId)}`);
  }
  const action = readAction(input.action);
  const targetKind = readTargetKind(input.targetKind);
  const targetKey = targetKind === 'ranking' ? '*' : input.targetKey.trim();
  const reason = input.reason.trim();
  if (targetKey === '' || reason === '') {
    throw new Error('a contest, a target and a reason are required');
  }
  if (!KIND_VERBS[targetKind].includes(action)) {
    throw new Error(`a ${targetKind} target does not accept the ${action} action`);
  }
  return {
    contestId: Number.parseInt(contestId, 10),
    targetKind,
    targetKey,
    action,
    value: action === 'hide' ? '' : input.value.trim(),
    reason,
  };
}

/** The row shape both the single and the batch create hand to Prisma. */
function toCreateData(row: NormalisedOverride, actorId: number) {
  return {
    contest_id: row.contestId,
    target_kind: row.targetKind,
    target_key: row.targetKey,
    action: row.action,
    payload: row.value === '' ? undefined : { value: row.value },
    reason: row.reason,
    created_by: actorId,
  };
}

/**
 * Refuses a scope the ranking cannot serve.
 *
 * WHY the contest is checked against the database: an override scopes its exception to one contest
 * the board draws, so a row naming a contest the ranking cannot serve is a scope that never
 * matches — refused here rather than filed as a dead row an operator later reads as "the hide did
 * not work".
 */
async function requireContestScope(scope: number): Promise<void> {
  const contest = await prisma.contests.findUnique({
    where: { id: scope },
    select: { id: true },
  });
  if (contest === null) {
    throw new Error(`no contest with id ${scope} to scope this override`);
  }
}

/**
 * Files one override.
 *
 * WHY the target and the verb are read through the shared vocabulary: the form offers these verbs
 * and this refuses anything outside them, so a second copy would let the picker offer a verb the
 * server then rejects.
 */
export async function addOverride(actorId: number, input: OverrideInput): Promise<void> {
  const row = normaliseOverrideInput(input);
  await requireContestScope(row.contestId);
  await prisma.ranking_overrides.create({ data: toCreateData(row, actorId) });
  await recordAudit({
    actorId,
    verb: 'ranking:override:create',
    entity: 'ranking',
    entityId: `${row.targetKind}:${row.targetKey}`,
    afterValues: { contestId: row.contestId, targetKind: row.targetKind, targetKey: row.targetKey, action: row.action, value: row.value },
    reason: row.reason,
    result: 'success',
  });
}

/**
 * Files one override for each stated target in a single transaction.
 *
 * WHY the batch and not N calls to `addOverride`: the bulk surface composes one correction and
 * applies it to a whole selection, so the rows have to land together — a half-filed batch would
 * leave the board carrying the exception for some of the targets the operator named and not the
 * rest, with nothing on screen saying which. WHY the whole batch is refused when any target is
 * out of vocabulary or names a contest the ranking cannot serve: a selection is a set of rows, and
 * writing the subset that parsed would file a different set than the caller named.
 *
 * returns: how many overrides were filed, so the caller can state the result count.
 */
export async function addOverrides(
  actorId: number,
  inputs: readonly OverrideInput[],
): Promise<number> {
  if (inputs.length === 0) throw new Error('select at least one override to file');
  const rows = inputs.map(normaliseOverrideInput);
  const scopes = [...new Set(rows.map((row) => row.contestId))];
  for (const scope of scopes) {
    await requireContestScope(scope);
  }
  const created = await prisma.$transaction(
    rows.map((row) => prisma.ranking_overrides.create({ data: toCreateData(row, actorId) })),
  );
  await recordAudit({
    actorId,
    verb: 'ranking:override:create',
    entity: 'ranking',
    entityId: rows.map((row) => `${row.targetKind}:${row.targetKey}`).join(','),
    afterValues: {
      contestIds: scopes,
      rows: rows.map((row) => ({
        contestId: row.contestId,
        targetKind: row.targetKind,
        targetKey: row.targetKey,
        action: row.action,
        value: row.value,
      })),
      filed: created.length,
    },
    reason: rows[0].reason,
    result: 'success',
  });
  return created.length;
}

/**
 * Ends override rows in one audited write.
 *
 * Ending is not deleting: the row keeps its creation reason and gains the ending actor
 * and time, so "who hid this row and why" survives the correction. The ending reason goes
 * to the audit log, which is where a correction belongs.
 *
 * WHY one reason for the batch: the reason explains the correction the operator is making, and it
 * is the same correction across the selection, so asking per row would ask the same question N
 * times. WHY `active: true` stays in the filter: a row already ended by another operator must not
 * have its ending timestamp overwritten by this batch. WHY a non-integer id is a refusal rather
 * than a drop: a selection names rows, and writing the subset that parsed would end a different
 * set than the caller named.
 *
 * returns: how many rows were actually ended, so a caller that named one row can refuse to report
 * success for a write that matched nothing.
 */
export async function endOverrides(
  actorId: number,
  ids: readonly number[],
  reason: string,
): Promise<number> {
  const trimmed = reason.trim();
  if (trimmed === '') throw new Error('ending an override needs a reason');
  const refused = ids.filter((id) => !Number.isInteger(id) || id < 0);
  if (refused.length > 0) throw new Error(`not an override id: ${refused.join(', ')}`);
  if (ids.length === 0) throw new Error('select at least one override to end');
  const { count } = await prisma.ranking_overrides.updateMany({
    where: { id: { in: ids.map((id) => BigInt(id)) }, active: true },
    data: { active: false, ended_at: new Date(), ended_by: actorId },
  });
  // WHY a no-op end files nothing: the trail records what an action changed, and an end that
  // matched no active row changed nothing. The count is still reported so the caller can say so.
  if (count === 0) return count;
  await recordAudit({
    actorId,
    verb: 'ranking:override:end',
    entity: 'ranking',
    entityId: ids.join(','),
    afterValues: { active: false, ids },
    reason: trimmed,
    result: 'success',
  });
  return count;
}
