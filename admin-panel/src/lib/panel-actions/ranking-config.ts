import { recordAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { isConfigTarget } from '@/lib/ranking-config';
import { projectContestStatements } from '@/lib/ranking-projection';

/**
 * The writes behind the board's config: what the ranking shows.
 *
 * WHY this lives apart from the panel's server action: the panel form and the `./cms panel config`
 * verb have to put a contest on the board the same way and end it the same way, so the semantics —
 * what a target is, that the projection row travels with the config row, and what the audit row
 * says — belong to one module both boundaries call. Nothing here reads a request, so the CLI runs
 * it in-process with no panel server up.
 *
 * WHY only the active rows are read here: ending a target keeps its row so "who showed this and
 * why" survives the correction, so the surface that answers "what is on the board now" reads the
 * live set (`ranking-config-store`).
 */

/** One target the operator puts on the board, as either boundary states it. */
export interface ShownTargetInput {
  readonly kind: string;
  readonly targetKey: string;
  readonly reason: string;
}

/**
 * Puts a contest on the board, and makes the board current in the same transaction.
 *
 * WHY the config row and the projection row land together: the reader draws the ranking_* copy,
 * so a config row committed on its own would put a contest on the board before the row that
 * names it exists, and the header would be blank until the six-minute sweep caught up. One
 * transaction means the board is current the moment the operator's write commits.
 *
 * WHY the shown row is ended and re-inserted rather than updated in place: ending is not
 * deleting, so a row keeps its author and its reason, and "who showed this contest and why"
 * survives every later change. Doing it as an end-then-insert makes a repeat idempotent without
 * a read-then-write race.
 *
 * WHY no task rows are written here: a projected task carries a max score and extra headers
 * derived from the dataset's score type, which is the proxy's derivation. Re-deriving it here
 * would be a second implementation of the projection and would drift from the first — so task
 * rows stay the push's business, and the sweep is the safety net for a task edited outside the
 * panel. Everything the panel can derive without duplicating that logic, it writes.
 *
 * WHY a target kind the reader cannot draw and a key that is not a contest id are both refusals:
 * a `ranking_config` row is the reader's declaration of what to draw, so a row written under a
 * word or a key the reader rejects is refused at every board route — cheaper to refuse here than
 * to leave a config that quietly does nothing. `projectContestStatements` refuses a contest the
 * database does not carry, which is the scope the ranking cannot serve at all.
 */
export async function showConfigTarget(actorId: number, target: ShownTargetInput): Promise<void> {
  const kind = target.kind.trim();
  if (!isConfigTarget(kind)) {
    throw new Error(`unknown config target: ${kind}`);
  }
  const targetKey = target.targetKey.trim();
  if (!/^\d+$/.test(targetKey)) {
    throw new Error('a shown target key is a contest id');
  }
  const reason = target.reason.trim();
  if (reason === '') {
    throw new Error('showing a target needs a reason');
  }
  const projection = await projectContestStatements(Number.parseInt(targetKey, 10));
  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE ranking_config
      SET active = false, ended_at = CURRENT_TIMESTAMP, ended_by = ${actorId}
      WHERE target_kind = ${kind} AND target_key = ${targetKey} AND active`,
    prisma.ranking_config.create({
      data: { target_kind: kind, target_key: targetKey, reason, created_by: actorId },
    }),
    ...projection,
  ]);
  await recordAudit({
    actorId,
    verb: 'ranking:config:show',
    entity: 'ranking',
    entityId: `${kind}:${targetKey}`,
    afterValues: { kind, targetKey, reason },
    reason,
    result: 'success',
  });
}

/**
 * Takes targets off the board, keeping their rows.
 *
 * WHY the projection is not touched: showing nothing for a contest is a config fact, not a
 * statement about its rows — the projection still holds them, and a later show draws them again
 * without waiting for a push. Deleting or refusing to draw them is the override's job, and the
 * two are different surfaces on purpose.
 *
 * WHY an id that is not an id is a refusal and not a drop: a selection is a set of `ranking_config`
 * ids, and quietly writing the ones that parsed would end a different set than the caller named —
 * the kind of silent skip a script-side caller cannot see on a screen. WHY one reason: the
 * correction is the same across the selection.
 *
 * returns: how many rows were actually ended, so a caller that named one target can refuse to
 * report success for a write that matched nothing.
 */
export async function endConfigTargets(
  actorId: number,
  ids: readonly string[],
  reason: string,
): Promise<number> {
  const trimmed = reason.trim();
  if (trimmed === '') throw new Error('ending a shown target needs a reason');
  if (ids.length === 0) throw new Error('select at least one target to end');
  const targets = ids.map((id) => id.trim());
  const refused = targets.filter((id) => !/^\d+$/.test(id));
  if (refused.length > 0) {
    throw new Error(`not a shown-target id: ${refused.join(', ')}`);
  }
  const { count } = await prisma.ranking_config.updateMany({
    where: { id: { in: targets.map((id) => BigInt(id)) }, active: true },
    data: { active: false, ended_at: new Date(), ended_by: actorId },
  });
  // WHY a no-op end files nothing: the trail records what an action changed, and an end that
  // matched no active row changed nothing — a "success" row for it would be the silent skip this
  // module refuses, written down. The count is still reported so the caller can say so.
  if (count === 0) return count;
  await recordAudit({
    actorId,
    verb: 'ranking:config:end',
    entity: 'ranking',
    entityId: targets.join(','),
    afterValues: { active: false, ids: targets },
    reason: trimmed,
    result: 'success',
  });
  return count;
}
