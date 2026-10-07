import { prisma } from '@/lib/prisma';

export interface ActionResult {
  success: boolean;
  error?: string;
}

export interface BulkItemResult {
  codename: string;
  status: 'created' | 'skipped' | 'failed';
  error?: string;
}

/** Error result when the dataset id is invalid or the dataset is missing. */
export async function findDatasetOrError(datasetId: number): Promise<ActionResult | null> {
  if (!Number.isInteger(datasetId)) return { success: false, error: 'Invalid dataset' };
  const dataset = await prisma.datasets.findUnique({ where: { id: datasetId }, select: { id: true } });
  if (!dataset) return { success: false, error: 'Dataset not found' };
  return null;
}

/** Client-safe message for an upload failure; unknown errors are logged server-side. */
export function toSafeActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown error';
  if (message.startsWith('Insufficient')) return message;
  if (message.includes('Unique constraint') || message.includes('unique constraint')) {
    return 'A testcase with this codename already exists in this dataset';
  }
  if (message.includes('Foreign key constraint') || message.includes('P2003')) {
    return 'Dataset not found';
  }
  console.error('Testcase upload failed', error);
  return 'Upload failed. Contact an administrator if this persists.';
}
