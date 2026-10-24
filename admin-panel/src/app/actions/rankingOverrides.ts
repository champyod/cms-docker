'use server';

import { revalidatePath } from 'next/cache';

import { loadActorNames } from '@/lib/admin-names';
import { addOverride, addOverrides, endOverrides, type OverrideInput } from '@/lib/panel-actions';
import { requirePanelActorId } from '@/lib/panel-actor';
import { ensurePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

/**
 * The override surface: the exceptions that win over the board's config.
 *
 * WHY these are thin wrappers over `panel-actions`: `./cms panel override` files and ends the same
 * rows while no panel server is up, so the target vocabulary, the scope check and the audit row
 * live in that module and this file adds only what a panel request owns — the permission gate, the
 * session actor and the screen refresh.
 */

export interface RankingOverride {
  id: string;
  contestId: number;
  targetKind: string;
  targetKey: string;
  action: string;
  value: string;
  reason: string;
  createdAt: string;
  /**
   * The admin who filed the row, or `null` when it was written outside the panel.
   *
   * WHY nullable rather than resolved: "no author" is the fact the list has to show — a row filed
   * by hand, by an import or by the classic admin never reaches `recordAudit`, so it is the only
   * trace of a write the panel did not make.
   */
  createdBy: number | null;
  createdByName: string | null;
}

/**
 * The active overrides, optionally narrowed to one contest.
 *
 * WHY the filter is here and not in the caller: the table has always carried
 * `contest_id` and the save path has always required it, but the reader ignored the
 * column, so an operator picking a contest in the form saw it have no effect on what
 * was listed. Narrowing in the query is what makes the selector mean something.
 *
 * WHY optional: the console-wide list on the settings page is deliberately every
 * contest. Only a contest-scoped surface passes an id.
 */
export async function getRankingOverrides(contestId?: number): Promise<RankingOverride[]> {
  await ensurePermission('ranking:read');
  const rows = await prisma.ranking_overrides.findMany({
    where: {
      active: true,
      ...(contestId === undefined ? {} : { contest_id: contestId }),
    },
    orderBy: { id: 'desc' },
    take: 200,
    select: {
      id: true,
      contest_id: true,
      target_kind: true,
      target_key: true,
      action: true,
      payload: true,
      reason: true,
      created_at: true,
      created_by: true,
    },
  });
  const names = await loadActorNames(
    rows.map((row) => row.created_by).filter((id): id is number => id !== null),
  );
  return rows.map((row) => toOverride(row, names));
}

/** Files one override. The write itself is `addOverride`. */
export async function saveRankingOverride(formData: FormData): Promise<void> {
  await ensurePermission('ranking:override');
  const actorId = await requirePanelActorId();
  await addOverride(actorId, {
    contestId: readText(formData, 'contestId'),
    targetKind: readText(formData, 'targetKind'),
    targetKey: readText(formData, 'targetKey'),
    action: readText(formData, 'action'),
    value: readText(formData, 'value'),
    reason: readText(formData, 'reason'),
  });
  revalidateOverridePages();
}

/**
 * Files one override per stated target in one write.
 *
 * WHY the bulk add is a server action over `addOverrides` and not a loop here: the panel's bulk
 * surface composes one correction for a whole selection, so the rows have to land together and the
 * vocabulary/scope rules have to be the ones the single form applies. The write lives in
 * `lib/panel-actions/ranking-overrides` and this adds only the permission, the actor and the
 * refresh.
 */
export async function saveRankingOverrides(inputs: readonly OverrideInput[]): Promise<number> {
  await ensurePermission('ranking:override');
  const actorId = await requirePanelActorId();
  const filed = await addOverrides(actorId, inputs);
  revalidateOverridePages();
  return filed;
}

/** Ends one override, addressed by its id. */
export async function endRankingOverride(formData: FormData): Promise<void> {
  await ensurePermission('ranking:override');
  const actorId = await requirePanelActorId();
  const raw = readText(formData, 'id');
  if (!/^\d+$/.test(raw)) {
    throw new Error('the override id is not a number');
  }
  await endOverrides(actorId, [Number.parseInt(raw, 10)], readText(formData, 'reason'));
  revalidateOverridePages();
}

/** Ends a selection of overrides in one audited write, under one reason. */
export async function endRankingOverrides(ids: readonly number[], reason: string): Promise<number> {
  await ensurePermission('ranking:override');
  const actorId = await requirePanelActorId();
  const ended = await endOverrides(actorId, ids, reason);
  revalidateOverridePages();
  return ended;
}

/** The list is the override surface now, and the detail view reads the same rows. */
function revalidateOverridePages(): void {
  revalidatePath('/[locale]/ranking/users');
  revalidatePath('/[locale]/ranking/users/[key]');
}

function toOverride(
  row: {
    id: bigint;
    contest_id: number;
    target_kind: string;
    target_key: string;
    action: string;
    payload: unknown;
    reason: string | null;
    created_at: Date;
    created_by: number | null;
  },
  actorNames: ReadonlyMap<number, string>,
): RankingOverride {
  return {
    id: row.id.toString(),
    contestId: row.contest_id,
    targetKind: row.target_kind,
    targetKey: row.target_key,
    action: row.action,
    value: readValue(row.payload),
    reason: row.reason ?? '',
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    // WHY no `#id` fallback here: the surface decides how it words an author, and this read only
    // knows the name it could find. Keeping the id beside a missing name is the surface's job.
    createdByName: row.created_by === null ? null : (actorNames.get(row.created_by) ?? null),
  };
}

function readValue(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const value = (payload as Record<string, unknown>).value;
  return typeof value === "string" ? value : "";
}

function readText(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}
