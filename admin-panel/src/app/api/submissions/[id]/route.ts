import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';
import {
  updateSubmissionComment,
  toggleSubmissionOfficial,
  recalculateSubmission,
} from '@/app/actions/submissions';

interface ActionResult {
  success: boolean;
  error?: string;
}

interface SubmissionActionBody {
  action?: string;
  comment?: string;
  type?: string;
  reason?: string;
  datasetId?: number | string;
}

async function dispatchSubmissionAction(
  id: number,
  data: SubmissionActionBody
): Promise<ActionResult> {
  switch (data.action) {
    case 'comment':
      return updateSubmissionComment(id, String(data.comment ?? ''));
    case 'toggle-official':
      return toggleSubmissionOfficial(id, trimmed(data.reason));
    case 'recalculate':
      return recalculateSubmission(id, recalcTypeOf(data.type), {
        reason: String(data.reason ?? ''),
        datasetId: optionalInt(data.datasetId),
      });
    default:
      return { success: false, error: 'Invalid action' };
  }
}

function trimmed(value?: string): string | undefined {
  const result = value?.trim() ?? '';
  return result === '' ? undefined : result;
}

function optionalInt(value?: number | string): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function recalcTypeOf(type?: string): 'score' | 'evaluation' | 'full' {
  return type === 'evaluation' || type === 'full' ? type : 'score';
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiPermission('submission:update');
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  const data = await req.json();
  const result = await dispatchSubmissionAction(id, data);

  if (!result.success) {
    const status = result.error === 'Submission not found' ? 404 : 400;
    return apiError({ message: result.error ?? 'Update failed', status });
  }

  await recordAudit({
    verb: 'submission:update',
    entity: 'submission',
    entityId: String(id),
    afterValues: { action: (data as { action?: string }).action, submissionId: id },
    result: 'success',
  });
  revalidatePath('/[locale]/evaluation/submissions', 'page');
  revalidatePath('/[locale]/evaluation/submissions/[id]', 'page');
  return apiSuccess({ message: 'Submission updated successfully' });
}
