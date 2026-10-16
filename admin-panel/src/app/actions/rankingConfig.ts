'use server';

import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { getSession } from '@/lib/auth';
import { ensurePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import {
  isConfigTarget,
  type ShownTarget,
  type ShownTargetChoice,
} from '@/lib/ranking-config';
import { projectContestStatements } from '@/lib/ranking-projection';

/**
 * What the board's config shows, as the panel renders it.
 *
 * WHY only the active rows: ending a target keeps its row so "who showed this and why" survives
 * the correction, so the surface that answers "what is on the board now" reads the live set.
 */
export async function getShownTargets(): Promise<ShownTarget[]> {
  await ensurePermission('ranking:read');
  const rows = await prisma.ranking_config.findMany({
    where: { active: true },
    orderBy: { id: 'desc' },
    take: 200,
  });
  return rows.map(toShownTarget);
}

/** The contests the operator can put on the board. Gated on reading, not on writing. */
export async function getShownTargetChoices(): Promise<ShownTargetChoice[]> {
  await ensurePermission('ranking:read');
  const contests = await prisma.contests.findMany({
    select: { id: true, name: true },
    orderBy: { id: 'desc' },
    take: 200,
  });
  return contests.map((contest) => ({ id: contest.id, name: contest.name }));
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
 */
export async function showTarget(formData: FormData): Promise<void> {
  await ensurePermission('ranking:override');
  const kind = readKind(formData);
  const targetKey = readTargetKey(formData);
  const reason = readText(formData, 'reason');
  if (reason === '') {
    throw new Error('showing a target needs a reason');
  }
  const contestId = readContestId(formData);
  const actorId = await currentActorId();
  const projection = await projectContestStatements(contestId);
  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE ranking_config
      SET active = false, ended_at = CURRENT_TIMESTAMP, ended_by = ${actorId ?? null}
      WHERE target_kind = ${kind} AND target_key = ${targetKey} AND active`,
    prisma.ranking_config.create({
      data: { target_kind: kind, target_key: targetKey, reason, created_by: actorId },
    }),
    ...projection,
  ]);
  await recordAudit({
    verb: 'ranking:config:show',
    entity: 'ranking',
    entityId: `${kind}:${targetKey}`,
    afterValues: { kind, targetKey, reason },
    reason,
    result: 'success',
  });
  revalidateConfigPages();
}

/**
 * Takes a target off the board, keeping its row.
 *
 * WHY the projection is not touched: showing nothing for a contest is a config fact, not a
 * statement about its rows — the projection still holds them, and a later show draws them again
 * without waiting for a push. Deleting or refusing to draw them is the override's job, and the
 * two are different surfaces on purpose.
 */
export async function endTarget(id: string, reason: string): Promise<void> {
  await ensurePermission('ranking:override');
  await endTargets([id], reason);
}

/** Ends many rows in one audited write. WHY one reason: the correction is the same across them. */
export async function endTargets(ids: readonly string[], reason: string): Promise<void> {
  await ensurePermission('ranking:override');
  const trimmed = reason.trim();
  const targets = ids.filter((id) => /^\d+$/.test(id));
  if (trimmed === '') throw new Error('ending a shown target needs a reason');
  if (targets.length === 0) throw new Error('select at least one target to end');
  const actorId = await currentActorId();
  await prisma.ranking_config.updateMany({
    where: { id: { in: targets.map((id) => BigInt(id)) }, active: true },
    data: { active: false, ended_at: new Date(), ended_by: actorId },
  });
  await recordAudit({
    verb: 'ranking:config:end',
    entity: 'ranking',
    entityId: targets.join(','),
    afterValues: { active: false, ids: targets },
    reason: trimmed,
    result: 'success',
  });
  revalidateConfigPages();
}

/** The config surface lives on the ranking users page, with the override surface it precedes. */
function revalidateConfigPages(): void {
  revalidatePath('/[locale]/ranking/users');
}

function toShownTarget(row: {
  id: bigint;
  target_kind: string;
  target_key: string;
  reason: string | null;
  created_at: Date;
  created_by: number | null;
}): ShownTarget {
  return {
    id: row.id.toString(),
    kind: row.target_kind,
    key: row.target_key,
    reason: row.reason ?? '',
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
  };
}

function readKind(formData: FormData): string {
  const raw = String(formData.get('kind') ?? '').trim();
  if (!isConfigTarget(raw)) {
    throw new Error(`unknown config target: ${raw}`);
  }
  return raw;
}

function readTargetKey(formData: FormData): string {
  const raw = String(formData.get('targetKey') ?? '').trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error('a shown target key is a contest id');
  }
  return raw;
}

/** The contest whose own projection row is refreshed with the config row. */
function readContestId(formData: FormData): number {
  const raw = String(formData.get('targetKey') ?? '').trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error('a shown target key is a contest id');
  }
  return Number.parseInt(raw, 10);
}

function readText(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

/** The audit helper resolves the actor itself; created_by needs the same id explicitly. */
async function currentActorId(): Promise<number | undefined> {
  const session = await getSession();
  if (session === null) return undefined;
  const parsed = Number.parseInt(session.userId, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
