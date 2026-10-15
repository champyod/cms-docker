'use server';

import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { getSession } from '@/lib/auth';
import { ensurePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import {
  KIND_VERBS,
  OVERRIDE_ACTIONS,
  OVERRIDE_TARGETS,
  type OverrideAction,
  type OverrideTarget,
} from '@/lib/ranking-override-verbs';

export interface RankingOverride {
  id: string;
  contestId: number;
  targetKind: string;
  targetKey: string;
  action: string;
  value: string;
  reason: string;
  createdAt: string;
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
  });
  return rows.map(toOverride);
}

export async function saveRankingOverride(formData: FormData): Promise<void> {
  await ensurePermission('ranking:override');
  const contestId = Number.parseInt(String(formData.get('contestId') ?? ''), 10);
  const action = readAction(formData);
  const targetKind = readTargetKind(formData);
  const targetKey = targetKind === 'ranking' ? '*' : readText(formData, 'targetKey');
  const reason = readText(formData, 'reason');
  if (!Number.isInteger(contestId) || targetKey === "" || reason === "") {
    throw new Error("a contest, a target and a reason are required");
  }
  if (!KIND_VERBS[targetKind].includes(action)) {
    throw new Error(`a ${targetKind} target does not accept the ${action} action`);
  }
  const value = action === "hide" ? "" : readText(formData, "value");
  const actorId = await currentActorId();
  await prisma.ranking_overrides.create({
    data: {
      contest_id: contestId,
      target_kind: targetKind,
      target_key: targetKey,
      action,
      payload: value === "" ? undefined : { value },
      reason,
      created_by: actorId,
    },
  });
  await recordAudit({
    verb: 'ranking:override:create',
    entity: 'ranking',
    entityId: `${targetKind}:${targetKey}`,
    afterValues: { contestId, targetKind, targetKey, action, value },
    reason,
    result: 'success',
  });
  revalidatePath('/[locale]/ranking/settings');
}

/**
 * Ending is not deleting: the row keeps its creation reason and gains the ending actor
 * and time, so "who hid this row and why" survives the correction. The ending reason goes
 * to the audit log, which is where a correction belongs.
 */
export async function endRankingOverride(formData: FormData): Promise<void> {
  await ensurePermission('ranking:override');
  const reason = readText(formData, "reason");
  const id = readOverrideId(formData);
  if (reason === "") {
    throw new Error("ending an override needs a reason");
  }
  const actorId = await currentActorId();
  await prisma.ranking_overrides.update({
    where: { id },
    data: { active: false, ended_at: new Date(), ended_by: actorId },
  });
  await recordAudit({
    verb: 'ranking:override:end',
    entity: 'ranking',
    entityId: id.toString(),
    afterValues: { active: false },
    reason,
    result: 'success',
  });
  revalidatePath('/[locale]/ranking/settings');
}

function toOverride(row: {
  id: bigint;
  contest_id: number;
  target_kind: string;
  target_key: string;
  action: string;
  payload: unknown;
  reason: string | null;
  created_at: Date;
}): RankingOverride {
  return {
    id: row.id.toString(),
    contestId: row.contest_id,
    targetKind: row.target_kind,
    targetKey: row.target_key,
    action: row.action,
    value: readValue(row.payload),
    reason: row.reason ?? '',
    createdAt: row.created_at.toISOString(),
  };
}

function readValue(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const value = (payload as Record<string, unknown>).value;
  return typeof value === "string" ? value : "";
}

function readAction(formData: FormData): OverrideAction {
  const raw = String(formData.get("action") ?? "");
  const found = OVERRIDE_ACTIONS.find((candidate) => candidate === raw);
  if (found === undefined) {
    throw new Error(`unknown override action: ${raw}`);
  }
  return found;
}

function readTargetKind(formData: FormData): OverrideTarget {
  const raw = String(formData.get("targetKind") ?? "");
  const found = OVERRIDE_TARGETS.find((candidate) => candidate === raw);
  if (found === undefined) {
    throw new Error(`unknown override target: ${raw}`);
  }
  return found;
}

function readOverrideId(formData: FormData): bigint {
  const raw = String(formData.get("id") ?? "");
  if (!/^\d+$/.test(raw)) {
    throw new Error("the override id is not a number");
  }
  return BigInt(raw);
}

function readText(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/** The audit helper resolves the actor itself; created_by needs the same id explicitly. */
async function currentActorId(): Promise<number | undefined> {
  const session = await getSession();
  if (session === null) return undefined;
  const parsed = Number.parseInt(session.userId, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

