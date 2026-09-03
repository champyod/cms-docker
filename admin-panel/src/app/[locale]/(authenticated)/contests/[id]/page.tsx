import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { ContestDetailView } from '@/components/contests/ContestDetailView';
import { getCurrentUser } from '@/app/actions/auth';
import { checkPermission } from '@/lib/permissions';
import { contestDetailInclude } from '@/lib/prisma-selects';

async function getContest(id: number) {
  return prisma.contests.findUnique({
    where: { id },
    include: contestDetailInclude,
  });
}

async function getAvailableUsers() {
  return prisma.users.findMany({
    orderBy: { username: 'asc' }
  });
}

async function getAvailableTasks() {
  return prisma.tasks.findMany({
    where: { contest_id: null },
    orderBy: { name: 'asc' }
  });
}

async function getTeams() {
  return prisma.teams.findMany({
    orderBy: { name: 'asc' }
  });
}

export default async function ContestDetailPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  // Why: forbidden detail must be indistinguishable from missing so return 404 not redirect
  if (!await checkPermission('contests', false)) notFound();

  const contestId = parseInt(id, 10);

  if (isNaN(contestId)) {
    notFound();
  }

  const [contest, availableUsers, availableTasks, teams, user] = await Promise.all([
    getContest(contestId),
    getAvailableUsers(),
    getAvailableTasks(),
    getTeams(),
    getCurrentUser()
  ]);

  if (!contest) {
    notFound();
  }

  if (!user) {
    // Layout guard normally covers this; kept for the type-narrowing the render below relies on.
    return null;
  }

  return (
    <div className="space-y-8">
      <ContestDetailView
        contest={contest}
        availableUsers={availableUsers}
        availableTasks={availableTasks}
        teams={teams}
        user={user}
      />
    </div>
  );
}

