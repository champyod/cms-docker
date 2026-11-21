import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission, getPermissions } from '@/lib/permissions';
import { stripDisallowedFields } from '@/lib/field-permissions';
import { recordAudit } from '@/lib/audit';
import { resyncRankingUsers } from '@/lib/ranking-projection';
import {
  executeBulkParticipationSettings,
  parseIpAllowlist,
  type BulkParticipationSettings,
} from './participation-sql';

export interface BulkParticipationResult {
  success: boolean;
  error?: string;
  updated?: number;
}

export interface ResolvedParticipationSettings {
  allowed: BulkParticipationSettings;
  validIps: string[];
  error?: string;
}

/** Drops fields the caller may not update, then validates the surviving IP allowlist. */
export function resolveParticipationSettings(
  settings: BulkParticipationSettings,
  permissions: ReadonlySet<string>,
): ResolvedParticipationSettings {
  const allowed = stripDisallowedFields(
    'participations',
    settings as Record<string, unknown>,
    permissions,
  ) as BulkParticipationSettings;
  const { validIps, error } = parseIpAllowlist(allowed.ip);
  return { allowed, validIps, error };
}

/** Resolves an untrusted allowlist body value against the caller's field surface. */
export function resolveAllowlistInput(
  raw: unknown,
  permissions: ReadonlySet<string>,
): { validIps: string[]; error?: string } {
  const { validIps, error } = resolveParticipationSettings({ ip: typeof raw === 'string' ? raw : undefined }, permissions);
  return { validIps, error };
}

/** The one bulk writer for participation settings; every entry point funnels through it. */
export async function applyBulkParticipationSettings(
  contestId: number,
  userIds: readonly number[],
  settings: BulkParticipationSettings,
  auditAction: string,
): Promise<BulkParticipationResult> {
  await ensurePermission('participation:update');

  try {
    if (userIds.length === 0) {
      return { success: false, error: 'No members selected' };
    }

    const { allowed, validIps, error } = resolveParticipationSettings(settings, await getPermissions());
    if (error) return { success: false, error };

    const rows = await prisma.participations.findMany({
      where: { contest_id: contestId, user_id: { in: [...userIds] } },
      select: { id: true },
    });
    const participationIds = rows.map((row) => row.id);
    await executeBulkParticipationSettings(participationIds, allowed, validIps);

    await resyncRankingUsers(contestId);
    await recordAudit({
      verb: 'participation:update',
      entity: 'contest',
      entityId: String(contestId),
      afterValues: { action: auditAction, contestId, participationIds, settings: allowed, ip: validIps },
      result: 'success',
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true, updated: participationIds.length };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
