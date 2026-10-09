'use server';

import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { getSession } from '@/lib/auth';
import { ensurePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

/**
 * The changes an operator may make to what the scoreboard shows. The list is closed on
 * purpose: an unknown verb from a form is refused rather than stored, so the reader never
 * has to guess what an action means.
 */
const OVERRIDE_ACTIONS = ['hide', 'guest', 'pin', 'rename', 'score'] as const;
export type OverrideAction = (typeof OVERRIDE_ACTIONS)[number];

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

export async function getRankingOverrides(): Promise<RankingOverride[]> {
  await ensurePermission('ranking:read');
  const rows = await prisma.ranking_overrides.findMany({
    where: { active: true },
    orderBy: { id: 'desc' },
    take: 200,
  });
  return rows.map(toOverride);
}

export async function saveRankingOverride(formData: FormData): Promise<void> {
  await ensurePermission('ranking:override');
  const contestId = Number.parseInt(String(formData.get('contestId') ?? ''), 10);
  const targetKind = readText(formData, 'targetKind');
  const targetKey = readText(formData, 'targetKey');
  const value = readText(formData, 'value');
  const reason = readText(formData, 'reason');
  const action = readAction(formData);
  if (!Number.isInteger(contestId) || targetKind === "" || targetKey === "" || reason === "") {
    throw new Error("a contest, a target and a reason are required");
  }
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
  revalidatePath('/[locale]/infrastructure/ranking');
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
  revalidatePath('/[locale]/infrastructure/ranking');
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

