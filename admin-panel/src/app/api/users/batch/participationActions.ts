import type { NextResponse } from 'next/server';
import { apiError, apiSuccess, verifyApiPermission } from '@/lib/api-utils';
import { applyBulkParticipationSettings } from '@/app/actions/participation-settings';
import type { BatchActionRequest } from './credentialActions';

const PARTICIPATION_MODES = ['ip'] as const;

export async function handleParticipation({ body, userIds }: BatchActionRequest): Promise<NextResponse> {
  if (userIds.length === 0) {
    return apiError({ message: 'userIds is required', status: 400 });
  }

  const mode = PARTICIPATION_MODES.find((candidate) => candidate === body.mode);
  if (!mode) {
    return apiError({ message: 'Invalid participation mode', status: 400 });
  }

  const contestId = Number(body.contestId);
  if (!Number.isInteger(contestId) || contestId <= 0) {
    return apiError({ message: 'Invalid contestId', status: 400 });
  }

  // WHY participation:update: this writes participations.ip. The shared action's
  // field strip then decides whether the caller may set an allowlist at all.
  const { authorized, response } = await verifyApiPermission('participation:update');
  if (!authorized) return response;

  const result = await applyBulkParticipationSettings(
    contestId,
    userIds,
    { ip: typeof body.ip === 'string' ? body.ip : '' },
    'batch-participation-ip',
  );
  if (!result.success) {
    return apiError({ message: result.error ?? 'Failed to update the IP allowlist', status: 400 });
  }
  return apiSuccess({ success: true, updatedCount: result.updated ?? 0 });
}
