import { getDictionary } from '@/i18n';
import { Card } from '@/components/core/Card';
import {
  Users,
  Trophy,
  FileCode,
  Activity,
  ArrowUpRight,
  Clock,
} from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { getServiceStatus } from '@/app/actions/services';
import { StatusBadge, StatusType } from '@/components/core/StatusBadge';
import { PageContent, PageHeader, Grid, Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';

async function getStats() {
  const [
    usersCount,
    contestsCount,
    activeContestsCount,
    submissionsCount,
    pendingSubmissions
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
    })
  ]);

  return {
    usersCount,
    contestsCount,
    activeContestsCount,
    submissionsCount,
    pendingSubmissions
  };
}

async function getRecentActivity() {
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

  return submissions.map(s => ({
    id: s.id,
    timestamp: s.timestamp,
    username: s.participations?.users?.username ?? 'Unknown',
    taskName: s.tasks?.name ?? 'Unknown',
  }));
}

export default async function DashboardPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  const dict = await getDictionary(locale);
  const [stats, serviceStatus, recentActivity] = await Promise.all([
    getStats(),
    getServiceStatus(),
    getRecentActivity(),
  ]);

  return (
    <PageContent>
      <PageHeader 
        title={dict.dashboard.welcome}
        description={dict.dashboard.description}
      />

      <Grid cols={4}>
        <Card className="p-6 flex flex-col gap-4 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Users className="w-24 h-24" />
          </div>
          <Stack direction="row" justify="between" align="start" className="z-10" gap={0}>
            <Stack gap={2}>
              <Text variant="small" color="text-neutral-400">{dict.dashboard.stats.totalUsers}</Text>
              <Text variant="h1">{stats.usersCount}</Text>
            </Stack>
            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
              <Users className="w-5 h-5" />
            </div>
          </Stack>
          <Stack direction="row" align="center" gap={2} className="z-10 text-green-400">
            <ArrowUpRight className="w-4 h-4" />
            <Text variant="small" color="text-green-400">Active Contesters</Text>
          </Stack>
        </Card>

        <Card className="p-6 flex flex-col gap-4 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Trophy className="w-24 h-24" />
          </div>
          <Stack direction="row" justify="between" align="start" className="z-10" gap={0}>
            <Stack gap={2}>
              <Text variant="small" color="text-neutral-400">{dict.dashboard.stats.totalContests}</Text>
              <Text variant="h1">{stats.contestsCount}</Text>
            </Stack>
            <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
              <Trophy className="w-5 h-5" />
            </div>
          </Stack>
          <Stack direction="row" align="center" gap={2} className="z-10 text-amber-400">
            <Activity className="w-4 h-4" />
            <Text variant="small" color="text-amber-400">{stats.activeContestsCount} Active Now</Text>
          </Stack>
        </Card>

        <Card className="p-6 flex flex-col gap-4 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <FileCode className="w-24 h-24" />
          </div>
          <Stack direction="row" justify="between" align="start" className="z-10" gap={0}>
            <Stack gap={2}>
              <Text variant="small" color="text-neutral-400">{dict.dashboard.stats.totalSubmissions}</Text>
              <Text variant="h1">{stats.submissionsCount}</Text>
            </Stack>
            <div className="p-2 bg-cyan-500/10 rounded-lg text-cyan-400">
              <FileCode className="w-5 h-5" />
            </div>
          </Stack>
          <Stack direction="row" align="center" gap={2} className="z-10 text-neutral-400">
            <Clock className="w-4 h-4" />
            <Text variant="small" color="text-neutral-400">{stats.pendingSubmissions} Pending</Text>
          </Stack>
        </Card>

        <Card className="p-6 flex flex-col gap-4 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Activity className="w-24 h-24" />
          </div>
          <StatusBadge 
            status={serviceStatus.status as StatusType} 
            running={(serviceStatus as any).running} 
            total={(serviceStatus as any).total} 
          />
        </Card>
      </Grid>

      <Stack gap={4}>
        <Text variant="h2">Recent Activity</Text>
        <Card className="p-6 overflow-hidden">
          {recentActivity.length > 0 ? (
            <Stack gap={3}>
              {recentActivity.map((item) => (
                <Stack key={item.id} direction="row" align="center" gap={4} className="p-3 rounded-lg bg-white/5 border border-white/5">
                  <div className="p-2 bg-cyan-500/10 rounded-lg text-cyan-400">
                    <FileCode className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Text variant="small">
                      <span className="font-medium text-indigo-400">{item.username}</span>
                      {' submitted to '}
                      <span className="font-medium text-amber-400">{item.taskName}</span>
                    </Text>
                  </div>
                  <Text variant="muted" className="whitespace-nowrap">
                    {item.timestamp ? new Date(item.timestamp).toLocaleString() : ''}
                  </Text>
                </Stack>
              ))}
            </Stack>
          ) : (
            <Stack align="center" justify="center" className="py-12">
              <Text variant="muted">No recent activity to display</Text>
            </Stack>
          )}
        </Card>
      </Stack>
    </PageContent>
  );
}
