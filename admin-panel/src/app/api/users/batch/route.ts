import { NextRequest } from 'next/server';
import { apiError, verifyApiPermission } from '@/lib/api-utils';
import { cleanupExpiredCreds } from '@/lib/creds-file';
import { handleApplyCredentials, handleExportCurrent, handleRegenerate } from './credentialActions';
import { handleContest, handleTeam } from './enrollmentActions';
import { handleProfile } from './profileActions';

const BATCH_ACTIONS = ['regenerate', 'contest', 'team', 'profile', 'apply-credentials', 'export-current'] as const;

function parseUserIds(body: Record<string, unknown>): number[] {
  if (!Array.isArray(body.userIds)) return [];
  return body.userIds
    .map((id: unknown) => Number(id))
    .filter((id: number) => Number.isInteger(id) && id > 0);
}

export async function POST(req: NextRequest) {
  const { authorized, response } = await verifyApiPermission('users');
  if (!authorized) return response;

  await cleanupExpiredCreds();

  try {
    const body = await req.json();
    const action = BATCH_ACTIONS.find((candidate) => candidate === body?.action);
    const userIds = parseUserIds(body);
    const request = { body, userIds };

    switch (action) {
      case 'regenerate':
        return handleRegenerate(request);
      case 'apply-credentials':
        return handleApplyCredentials(request);
      case 'export-current':
        return handleExportCurrent(request);
      case 'contest':
        return handleContest(request);
      case 'team':
        return handleTeam(request);
      case 'profile':
        return handleProfile(request);
      default:
        return apiError({ message: 'Invalid action', status: 400 });
    }
  } catch (error) {
    return apiError(error);
  }
}
