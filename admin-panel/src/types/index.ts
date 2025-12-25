import { submissions, submission_results, users, tasks, contests } from '@/generated/prisma/client';

export type SubmissionWithRelations = submissions & {
    participations: {
        users: users;
        contests: contests;
    };
    tasks: tasks;
    submission_results: submission_results[];
};
