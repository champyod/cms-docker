import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { prisma } from '@/lib/prisma';
import { getServiceStatus } from '@/app/actions/services';
import { DashboardState, DashboardSurface } from '@/components/dashboard/DashboardSurface';
import { DashboardPage } from '@/components/patterns/DashboardPage';
// Why the bare form: this page is a server component, so the activity row cannot read the
// reviewer's own zone from a client context; the zone of record is the one this process renders in.
import { formatInZone } from '@/lib/timezone';

async function getStats() {
  const now = new Date();
  const [
    usersCount,
    contestsCount,
    activeContestsCount,
    submissionsCount,
    pendingSubmissions,
    activeContesters
  ] = await Promise.all([
    prisma.users.count(),
    prisma.contests.count(),
    prisma.contests.count({
      where: {
        AND: [
          { start: { lte: new Date() } },
          { stop: { gte: new Date() } }
        ]
      }
    }),
    prisma.submissions.count(),
    prisma.submissions.count({
      where: {
        submission_results: {
          some: {
            score: null
          }
        }
      }
    }),
    prisma.participations.count({
      where: {
        contests: {
          start: { lte: now },
          stop: { gte: now }
        }
      }
    })
  ]);

  return {
    usersCount,
    contestsCount,
    activeContestsCount,
    submissionsCount,
    pendingSubmissions,
    activeContesters
  };
}

async function getRecentActivity(): Promise<{ id: number; timestamp: Date; username: string; taskName: string }[]> {
  const submissions = await prisma.submissions.findMany({
    take: 10,
    orderBy: { timestamp: 'desc' },
    include: {
      tasks: { select: { name: true } },
      participations: {
        include: {
          users: { select: { username: true } }
        }
      }
    }
  });

  type SubmissionRow = {
    participations?: { users?: { username: string } | null } | null;
    tasks?: { name: string } | null;
  } & {
    id: number; timestamp: Date;
  };

  return submissions.map((s: SubmissionRow): { id: number; timestamp: Date; username: string; taskName: string } => ({
    id: s.id,
    timestamp: s.timestamp,
    username: s.participations?.users?.username ?? 'Unknown',
    taskName: s.tasks?.name ?? 'Unknown',
  }));
}

export default async function AdminHomePage({
  params: paramsPromise,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await paramsPromise;
  const dict = await getDictionary(locale);
  // No guard: the registry declares this route open to every signed-in admin.

  const [stats, serviceStatus, recentActivity] = await Promise.all([
    getStats(),
    getServiceStatus(),
    getRecentActivity(),
  ]);

  const labels = dict.dashboard;
  const dashboardLabels = {
    serviceState: labels.serviceState,
    checkedAt: labels.checkedAt,
    servicesTitle: labels.servicesTitle,
    servicesDetail: labels.servicesDetail,
    stats: labels.stats,
    activity: labels.activity,
  };
  const service = {
    status: serviceStatus.status,
    running: serviceStatus.running,
    total: serviceStatus.total,
    checkedAt: formatInZone(new Date().toISOString()),
  };

  return (
    <DashboardPage
      title={dict.dashboard.welcome}
      description={dict.dashboard.description}
      state={<DashboardState service={service} labels={dashboardLabels} stats={stats} />}
    >
      <DashboardSurface
        stats={stats}
        service={service}
        activity={recentActivity.map((item) => ({
          id: item.id,
          username: item.username,
          taskName: item.taskName,
          when: item.timestamp ? formatInZone(item.timestamp.toISOString()) : '',
        }))}
        labels={dashboardLabels}
      />
    </DashboardPage>
  );
}
