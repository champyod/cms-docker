import { getFieldAccess } from '@/lib/field-permissions';
import { judgedTotalScore, judgingPhaseFor } from '@/lib/evaluation-read-model-judging';
import type { SubmissionJudgingState } from '@/lib/evaluation-read-model-types';
import { SUBMISSION_RESULT_SELECT } from '@/lib/evaluation-read-models';
import { toSubmissionResultRow } from '@/lib/evaluation-read-model-projections';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/server/authorization';

// Why a lean reader beside getSubmissionResults: the header status must not demand file:read.
export async function getSubmissionJudgingState(submissionId: number): Promise<SubmissionJudgingState | null> {
  const permissions = new Set<string>([
    ...await requirePermission('submission:read'),
    ...await requirePermission('submissionresult:read'),
  ]);
  const rows = await prisma.submission_results.findMany({
    where: { submission_id: submissionId },
    orderBy: { dataset_id: 'asc' },
    select: SUBMISSION_RESULT_SELECT,
  });
  const results = rows.map((entry) => toSubmissionResultRow(entry, getFieldAccess('submission_results', permissions)));
  return { phase: judgingPhaseFor(results), totalScore: judgedTotalScore(results) };
}
