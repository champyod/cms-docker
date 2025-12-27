import { submissions, submission_results, tasks } from '@prisma/client';

export type SubmissionWithRelations = submissions & {
    participations: {
        users: { username: string };
        contests: { name: string };
    };
    tasks: { id: number; name: string; title: string };
    submission_results: {
        score: number | null;
        dataset_id: number;
        compilation_outcome: string | null;
        evaluation_outcome: string | null;
    }[];
    files: { filename: string; digest: string }[];
};
