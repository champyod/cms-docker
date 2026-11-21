import { NextRequest } from 'next/server';

import { apiError, apiSuccess, verifyApiPermission } from '@/lib/api-utils';
import { getSubmissionTestcaseDetail } from '@/lib/evaluation-read-models';

// Why one route for one testcase: the detail tab lists every testcase from the
// server model, and a row's input/expected output are fetched only when it opens.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; testcaseId: string }> },
): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('submission:read');
  if (!authorized) return response;

  const { id, testcaseId } = await params;
  const submissionId = Number.parseInt(id, 10);
  const resolvedTestcaseId = Number.parseInt(testcaseId, 10);
  if (!Number.isInteger(submissionId) || !Number.isInteger(resolvedTestcaseId)) {
    return apiError({ message: 'Invalid submission or testcase id', status: 400 });
  }

  try {
    const detail = await getSubmissionTestcaseDetail(submissionId, resolvedTestcaseId);
    if (!detail) return apiError({ message: 'Testcase not found for this submission', status: 404 });
    return apiSuccess({ ...detail });
  } catch (error) {
    return apiError(error);
  }
}
