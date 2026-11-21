import type { Prisma } from '@prisma/client';
import type { safeUserSelect } from '@/lib/prisma-selects';

import type { SubmissionsListRow } from '@/lib/prisma-selects';

/** Row shape returned by getSubmissions() — light relations for table rendering. */
export type SubmissionListItem = SubmissionsListRow;
/**
 * Submission row with the full relation graph loaded by getSubmission()
 * (task, participation + user + contest, results + dataset, files, evaluations + testcases).
 */
export type SubmissionWithRelations = Prisma.submissionsGetPayload<{
  include: {
    tasks: true;
    participations: {
      include: {
        users: { select: typeof safeUserSelect };
        contests: true;
      };
    };
    submission_results: { include: { datasets: true } };
    files: true;
    evaluations: { include: { testcases: true } };
  };
}>;
