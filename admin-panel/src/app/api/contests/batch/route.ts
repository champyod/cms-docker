import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { apiError, apiSuccess, parseIdList } from '@/lib/api-utils';
import { pickLimitPatch, type LimitPatch } from '@/lib/limit-patch';
import * as contestService from '@/lib/services/contests';
import type { ContestData } from '@/lib/contests-repo';

const BATCH_ACTIONS = ['update-window', 'update-limits'] as const;
const WINDOW_BOOLEAN_FIELDS = ['allow_registration', 'ip_restriction', 'ip_autologin'] as const;

/** Keep only the fields a bulk window edit owns, so a request cannot reach the rest. */
function pickWindowPatch(raw: unknown): Partial<ContestData> {
  if (typeof raw !== 'object' || raw === null) return {};
  const source = raw as Record<string, unknown>;
  const patch: Partial<ContestData> = {};

  if (typeof source.timezone === 'string' && source.timezone !== '') patch.timezone = source.timezone;
  if (typeof source.start === 'string' && source.start !== '') patch.start = source.start;
  if (typeof source.stop === 'string' && source.stop !== '') patch.stop = source.stop;
  for (const key of WINDOW_BOOLEAN_FIELDS) {
    if (typeof source[key] === 'boolean') patch[key] = source[key];
  }

  return patch;
}

/** Run one per-target write and fold its outcome into the running counts. */
async function applyToEachContest(
  contestIds: readonly number[],
  write: (contestId: number) => Promise<{ success: boolean; error?: string }>,
): Promise<{ updatedCount: number; failed: Array<{ id: number; reason?: string }> }> {
  const failed: Array<{ id: number; reason?: string }> = [];
  let updatedCount = 0;
  for (const contestId of contestIds) {
    const result = await write(contestId);
    if (result.success) updatedCount += 1;
    else failed.push({ id: contestId, reason: result.error });
  }
  return { updatedCount, failed };
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = BATCH_ACTIONS.find((candidate) => candidate === body?.action);
    const contestIds = parseIdList(body.contestIds);

    if (action === undefined) {
      return apiError({ message: 'Invalid action', status: 400 });
    }
    if (contestIds.length === 0) {
      return apiError({ message: 'contestIds is required', status: 400 });
    }

    if (action === 'update-limits') {
      // Why the shared picker: it owns the six-name whitelist and the 0→NULL rule, so the route
      // cannot carry an unknown column or a literal 0 the CHECK refuses.
      const patch: LimitPatch | null = pickLimitPatch(body.patch);
      if (patch === null) {
        return apiError({ message: 'No limit fields in patch', status: 400 });
      }
      const { updatedCount, failed } = await applyToEachContest(contestIds, (contestId) => contestService.updateContestLimits(contestId, patch));
      revalidatePath('/[locale]/contests', 'page');
      return apiSuccess({ updatedCount, failed });
    }

    const patch = pickWindowPatch(body.patch);
    if (Object.keys(patch).length === 0) {
      return apiError({ message: 'No updatable fields in patch', status: 400 });
    }

    const { updatedCount, failed } = await applyToEachContest(contestIds, (contestId) => contestService.updateContestWindow(contestId, patch));

    revalidatePath('/[locale]/contests', 'page');
    return apiSuccess({ updatedCount, failed });
  } catch (error: unknown) {
    const e = error as { status?: number; message?: string };
    if (e.status === 401 || e.status === 403) {
      return apiError({ message: e.message, status: e.status });
    }
    return apiError(error);
  }
}
