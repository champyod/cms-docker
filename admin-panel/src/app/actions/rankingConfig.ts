'use server';

import { revalidatePath } from 'next/cache';

import { ensurePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { endConfigTargets, showConfigTarget } from '@/lib/panel-actions';
import { requirePanelActorId } from '@/lib/panel-actor';
import type { ShownTarget, ShownTargetChoice } from '@/lib/ranking-config';
import { readActiveConfigRows } from '@/lib/ranking-config-store';

/**
 * The board's config surface: what the ranking shows, as the panel reaches it.
 *
 * WHY these are thin wrappers over `panel-actions`: `./cms panel config` performs the same two
 * writes while no panel server is up, so the target vocabulary, the transaction and the audit row
 * live in that module and this file adds only what a panel request owns — the permission gate, the
 * session actor and the screen refresh.
 */

/**
 * What the board's config shows, as the panel renders it.
 *
 * WHY only the active rows: ending a target keeps its row so "who showed this and why" survives
 * the correction, so the surface that answers "what is on the board now" reads the live set.
 *
 * WHY the read is shared with `resyncRankingUsers`: the shown set is one fact, so the list this
 * page renders and the scope the projection write honours come from the same read
 * (`ranking-config-store`) rather than two queries that could drift.
 */
export async function getShownTargets(): Promise<ShownTarget[]> {
  await ensurePermission('ranking:read');
  const rows = await readActiveConfigRows();
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

/** Puts a contest on the board. The write itself is `showConfigTarget`. */
export async function showTarget(formData: FormData): Promise<void> {
  await ensurePermission('ranking:override');
  const actorId = await requirePanelActorId();
  await showConfigTarget(actorId, {
    kind: readText(formData, 'kind'),
    targetKey: readText(formData, 'targetKey'),
    reason: readText(formData, 'reason'),
  });
  revalidateConfigPages();
}

/** Takes one target off the board, keeping its row. */
export async function endTarget(id: string, reason: string): Promise<void> {
  await ensurePermission('ranking:override');
  await endTargets([id], reason);
}

/** Ends many rows in one audited write. */
export async function endTargets(ids: readonly string[], reason: string): Promise<void> {
  await ensurePermission('ranking:override');
  const actorId = await requirePanelActorId();
  await endConfigTargets(actorId, ids, reason);
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

function readText(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}
