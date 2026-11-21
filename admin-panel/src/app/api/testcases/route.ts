import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/lib/audit';
import { getPermissions } from '@/lib/permissions';
import { stripDisallowedFields } from '@/lib/field-permissions';
import { toSafeActionError, type BulkItemResult } from '@/app/actions/testcase-support';
import {
  parseTestcaseFormData,
  persistTestcasePair,
  type TestcaseUpload,
  type TestcaseUploadPair,
} from '@/lib/testcase-upload';
import { formatByteLimit, isRequestBodyTooLarge, MAX_TESTCASE_UPLOAD_BYTES } from '@/lib/testcase-limits';

async function persistPairs(datasetId: number, pairs: TestcaseUploadPair[]): Promise<BulkItemResult[]> {
  const details: BulkItemResult[] = [];
  for (const pair of pairs) {
    try {
      details.push({ codename: pair.codename, status: await persistTestcasePair(datasetId, pair) });
    } catch (error) {
      details.push({ codename: pair.codename, status: 'failed', error: toSafeActionError(error) });
    }
  }
  return details;
}

function summarizeUpload(details: BulkItemResult[]): { created: number; skipped: number; failed: BulkItemResult[] } {
  return {
    created: details.filter((detail) => detail.status === 'created').length,
    skipped: details.filter((detail) => detail.status === 'skipped').length,
    failed: details.filter((detail) => detail.status === 'failed'),
  };
}

export async function POST(req: NextRequest): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('testcase:create');
  if (!authorized) return response as Response;

  if (isRequestBodyTooLarge(req.headers.get('content-length'))) {
    return apiError({ message: `Upload exceeds the ${formatByteLimit(MAX_TESTCASE_UPLOAD_BYTES)} total limit`, status: 413 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return apiError({ message: 'Expected multipart/form-data request body', status: 400 });
  }

  let upload: TestcaseUpload;
  try {
    upload = parseTestcaseFormData(formData);
  } catch (error) {
    return apiError(error);
  }

  const permissions = await getPermissions();
  const fieldGate = stripDisallowedFields('testcases', { codename: 'x', input: '', output: '', public: false }, permissions);
  if (fieldGate.codename === undefined || fieldGate.input === undefined || fieldGate.output === undefined) {
    return apiError({ message: 'Insufficient testcase field permissions', status: 403 });
  }

  const dataset = await prisma.datasets.findUnique({
    where: { id: upload.datasetId },
    select: { id: true },
  });
  if (!dataset) return apiError({ message: 'Dataset not found', status: 404 });

  const details = await persistPairs(upload.datasetId, upload.pairs);
  const { created, skipped, failed } = summarizeUpload(details);

  await recordAudit({
    verb: 'testcase:create',
    entity: 'testcase',
    afterValues: { datasetId: upload.datasetId, created, skipped, failed: failed.length },
    result: failed.length === 0 ? 'success' : 'failure',
  });
  revalidatePath('/[locale]/tasks', 'page');

  if (failed.length > 0) {
    return NextResponse.json({
      success: false,
      error: `${failed.length} of ${details.length} testcases failed to save`,
      details,
    });
  }
  return apiSuccess({ message: 'Testcase(s) uploaded successfully', details });
}
