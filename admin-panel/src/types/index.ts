import type { Prisma } from '@prisma/client';
import type { safeUserSelect } from '@/lib/prisma-selects';

/** Row shape returned by getSubmissions() — light relations for table rendering. */
export type SubmissionListItem = Prisma.submissionsGetPayload<{
  include: {
    tasks: { select: { id: true; name: true; title: true } };
    participations: {
      include: {
        users: { select: { username: true } };
        contests: { select: { name: true } };
      };
    };
    submission_results: {
      select: {
        score: true;
        dataset_id: true;
        compilation_outcome: true;
        evaluation_outcome: true;
        compilation_time: true;
        compilation_memory: true;
        compilation_text: true;
        compilation_stdout: true;
        compilation_stderr: true;
      };
    };
    files: { select: { filename: true; digest: true } };
  };
}>;

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
