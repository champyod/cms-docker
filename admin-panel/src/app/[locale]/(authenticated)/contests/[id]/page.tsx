import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { ContestDetailView } from '@/components/contests/ContestDetailView';
import { getCurrentUser } from '@/app/actions/auth';

async function getContest(id: number) {
  const contest = await prisma.contests.findUnique({
    where: { id },
    include: {
      tasks: {
        orderBy: { num: 'asc' }
      },
      participations: {
        include: {
          users: true
        }
      }
    }
  });
  return contest;
}

async function getAvailableUsers() {
  return prisma.users.findMany({
    orderBy: { username: 'asc' }
  });
}

async function getAvailableTasks() {
  // Tasks not yet assigned to any contest
  return prisma.tasks.findMany({
    where: { contest_id: null },
    orderBy: { name: 'asc' }
  });
}

export default async function ContestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contestId = parseInt(id, 10);
  
  if (isNaN(contestId)) {
    notFound();
  }

  const [contest, availableUsers, availableTasks, user] = await Promise.all([
    getContest(contestId),
    getAvailableUsers(),
    getAvailableTasks(),
    getCurrentUser()
  ]);

  if (!contest) {
    notFound();
  }

  if (!user) {
    // Should be handled by middleware/layout generally but for type safety:
    return null; // or redirect
  }

  return (
    <div className="space-y-8">
      <ContestDetailView 
        contest={contest as any} 
        availableUsers={availableUsers}
        availableTasks={availableTasks}
        user={user}
      />
    </div>
  );
}
