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
 * Files one override.
 *
 * WHY the target and the verb are read through the shared vocabulary: the form offers these verbs
 * and this refuses anything outside them, so a second copy would let the picker offer a verb the
 * server then rejects.
 *
 * WHY the contest is checked against the database: an override scopes its exception to one contest
 * the board draws, so a row naming a contest the ranking cannot serve is a scope that never
 * matches — refused here rather than filed as a dead row an operator later reads as "the hide did
 * not work".
 */
export async function addOverride(actorId: number, input: OverrideInput): Promise<void> {
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
  const scope = Number.parseInt(contestId, 10);
  const contest = await prisma.contests.findUnique({
    where: { id: scope },
    select: { id: true },
  });
  if (contest === null) {
    throw new Error(`no contest with id ${scope} to scope this override`);
  }
  const value = action === 'hide' ? '' : input.value.trim();
  await prisma.ranking_overrides.create({
    data: {
      contest_id: scope,
      target_kind: targetKind,
      target_key: targetKey,
      action,
      payload: value === '' ? undefined : { value },
      reason,
      created_by: actorId,
    },
  });
  await recordAudit({
    actorId,
    verb: 'ranking:override:create',
    entity: 'ranking',
    entityId: `${targetKind}:${targetKey}`,
    afterValues: { contestId: scope, targetKind, targetKey, action, value },
    reason,
    result: 'success',
  });
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
