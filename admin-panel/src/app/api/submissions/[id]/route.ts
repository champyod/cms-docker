import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
  updateSubmissionComment,
  toggleSubmissionOfficial,
  recalculateSubmission,
} from '@/app/actions/submissions';

interface ActionResult {
  success: boolean;
  error?: string;
}

async function dispatchSubmissionAction(
  id: number,
  data: { action?: string; comment?: string; type?: string }
): Promise<ActionResult> {
  switch (data.action) {
    case 'comment':
      return updateSubmissionComment(id, String(data.comment ?? ''));
    case 'toggle-official':
      return toggleSubmissionOfficial(id);
    case 'recalculate':
      return recalculateSubmission(id, (data.type as 'score' | 'evaluation' | 'full') ?? 'score');
    default:
      return { success: false, error: 'Invalid action' };
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiPermission('contests');
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  const data = await req.json();
  const result = await dispatchSubmissionAction(id, data);

  if (!result.success) {
    const status = result.error === 'Submission not found' ? 404 : 400;
    return apiError({ message: result.error ?? 'Update failed', status });
  }

  revalidatePath('/[locale]/submissions', 'page');
  return apiSuccess({ message: 'Submission updated successfully' });
}
