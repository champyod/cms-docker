'use server'

import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import { revalidatePath } from 'next/cache';

const SUBMISSIONS_PER_PAGE = 20;

export async function getSubmissions({ 
  page = 1, 
  search = '',
  contestId,
  taskId,
  userId
}: { 
  page?: number; 
  search?: string;
  contestId?: number;
  taskId?: number;
  userId?: number;
}) {
  const skip = (page - 1) * SUBMISSIONS_PER_PAGE;
  
  const where: Prisma.submissionsWhereInput = {};
  const participationFilter: Prisma.participationsWhereInput = {};
  
  if (contestId) participationFilter.contest_id = contestId;
  if (userId) participationFilter.user_id = userId;
  
  if (search) {
     const searchInt = parseInt(search);
     if (!isNaN(searchInt)) {
         where.id = searchInt;
     } else {
         // Search by user name relation
         participationFilter.users = {
             OR: [
                 { first_name: { contains: search, mode: 'insensitive' } },
                 { last_name: { contains: search, mode: 'insensitive' } },
                 { username: { contains: search, mode: 'insensitive' } },
             ]
         };
     }
  }

  if (Object.keys(participationFilter).length > 0) {
      where.participations = participationFilter;
  }

  const [submissions, total] = await Promise.all([
    prisma.submissions.findMany({
      where,
      skip,
      take: SUBMISSIONS_PER_PAGE,
      orderBy: { timestamp: 'desc' },
      include: {
        participations: {
            include: {
                users: true,
                contests: true
            }
        },
        tasks: true,
        submission_results: {
            // We usually want the result for the active dataset, but simplified: take the first one or all
            // Ideally we'd join with the task's active dataset, but Prisma doesn't make that easy in one go.
            // We'll fetch them all and filter in UI or just show the latest.
            orderBy: { dataset_id: 'desc' }, 
            take: 1
        }
      },
    }),
    prisma.submissions.count({ where }),
  ]);

  // Cast to specific type to ensure consistency, though Prisma infers it if includes are correct
  return {
    submissions: submissions as unknown as import('@/types').SubmissionWithRelations[],
    totalPages: Math.ceil(total / SUBMISSIONS_PER_PAGE),
    total,
  };
}

export async function recalculateSubmission(id: number, type: 'score' | 'evaluation' | 'full') {
    // We strictly follow cms/db/submission.py invalidate logic
    
    try {
        // 1. Get the relevant submission results (usually keys off dataset_id)
        // For simplicity/safety in admin panel, we'll reset ALL results for this submission
        // or we could look up the Task's active dataset. Let's start with all for this submission.
        
        const results = await prisma.submission_results.findMany({
            where: { submission_id: id }
        });

        if (results.length === 0) {
            return { success: false, error: 'No results found for submission' };
        }

        // We will perform updates in a transaction ideally, but loop is fine for admin action
        for (const result of results) {
            const { dataset_id } = result;
            const whereClause = { submission_id: id, dataset_id };

            // Logic for 'score' (ScoringService)
            // Invalidate score fields
            const resetScoreData = {
                score: null,
                score_details: Prisma.DbNull,
                public_score: null,
                public_score_details: Prisma.DbNull,
                ranking_score_details: [],
            };

            if (type === 'score') {
                await prisma.submission_results.update({
                    where: { submission_id_dataset_id: whereClause },
                    data: resetScoreData
                });
            }

            // Logic for 'evaluation' (EvaluationService)
            // Invalidate score + evaluation outcome + delete evaluations
            if (type === 'evaluation') {
                await prisma.submission_results.update({
                     where: { submission_id_dataset_id: whereClause },
                     data: {
                         ...resetScoreData,
                         evaluation_outcome: null,
                         evaluation_tries: 0,
                     }
                });
                // Delete evaluations
                await prisma.evaluations.deleteMany({
                    where: whereClause
                });
            }

            // Logic for 'full' (Worker -> Compilation)
            // Invalidate score + evaluation + compilation + delete executables
            if (type === 'full') {
                await prisma.submission_results.update({
                     where: { submission_id_dataset_id: whereClause },
                     data: {
                         ...resetScoreData,
                         evaluation_outcome: null,
                         evaluation_tries: 0,
                         compilation_outcome: null,
                         compilation_text: [],
                         compilation_tries: 0,
                         compilation_time: null,
                         compilation_wall_clock_time: null,
                         compilation_memory: null,
                         compilation_shard: null,
                         compilation_sandbox_paths: [],
                         compilation_sandbox_digests: [],
                     }
                });
                await prisma.evaluations.deleteMany({
                    where: whereClause
                });
                await prisma.executables.deleteMany({
                    where: whereClause
                });
            }
        }

        revalidatePath('/[locale]/submissions');
        return { success: true };

    } catch (error) {
        const e = error as Error;
        return { success: false, error: e.message };
    }
}
