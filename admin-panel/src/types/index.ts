import type { Prisma } from '@prisma/client';
import type { safeUserSelect } from '@/lib/prisma-selects';

import type { SubmissionsListRow } from '@/lib/prisma-selects';

export type SubmissionListItem = SubmissionsListRow;
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
