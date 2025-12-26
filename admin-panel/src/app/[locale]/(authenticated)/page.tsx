import { getDictionary } from '@/i18n';
import { Card } from '@/components/core/Card';
import {
  Users,
  Trophy,
  FileCode,
  Activity,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { prisma } from '@/lib/prisma';

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

export default async function DashboardPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  const dict = await getDictionary(locale);
  const stats = await getStats();

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          {dict.dashboard.welcome}
        </h1>
        <p className="text-neutral-400">
          {dict.dashboard.description}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="p-6 flex flex-col gap-4 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Users className="w-24 h-24" />
          </div>
          <div className="flex justify-between items-start z-10">
            <div>
              <p className="text-sm font-medium text-neutral-400">{dict.dashboard.stats.totalUsers}</p>
              <h3 className="text-3xl font-bold mt-2 text-white">{stats.usersCount}</h3>
            </div>
            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-green-400 z-10">
            <ArrowUpRight className="w-4 h-4" />
            <span>Active Contesters</span>
          </div>
        </Card>

        <Card className="p-6 flex flex-col gap-4 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Trophy className="w-24 h-24" />
          </div>
          <div className="flex justify-between items-start z-10">
            <div>
              <p className="text-sm font-medium text-neutral-400">{dict.dashboard.stats.totalContests}</p>
              <h3 className="text-3xl font-bold mt-2 text-white">{stats.contestsCount}</h3>
            </div>
            <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
              <Trophy className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-amber-400 z-10">
            <Activity className="w-4 h-4" />
            <span>{stats.activeContestsCount} Active Now</span>
          </div>
        </Card>

        <Card className="p-6 flex flex-col gap-4 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <FileCode className="w-24 h-24" />
          </div>
          <div className="flex justify-between items-start z-10">
            <div>
              <p className="text-sm font-medium text-neutral-400">{dict.dashboard.stats.totalSubmissions}</p>
              <h3 className="text-3xl font-bold mt-2 text-white">{stats.submissionsCount}</h3>
            </div>
            <div className="p-2 bg-cyan-500/10 rounded-lg text-cyan-400">
              <FileCode className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-neutral-400 z-10">
            <Clock className="w-4 h-4" />
            <span>{stats.pendingSubmissions} Pending</span>
          </div>
        </Card>

        <Card className="p-6 flex flex-col gap-4 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Activity className="w-24 h-24" />
          </div>
          <div className="flex justify-between items-start z-10">
            <div>
              <p className="text-sm font-medium text-neutral-400">System Status</p>
              <h3 className="text-3xl font-bold mt-2 text-green-500">Normal</h3>
            </div>
            <div className="p-2 bg-green-500/10 rounded-lg text-green-400">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-green-400 z-10">
            <span>All services operational</span>
          </div>
        </Card>
      </div>

      {/* Recent Activity Section */}
      <h2 className="text-xl font-semibold text-white mt-8">Recent Activity</h2>
      <Card className="p-6 overflow-hidden">
        <div className="flex items-center justify-center py-12 text-neutral-500">
          No recent activity to display
        </div>
      </Card>
    </div>
  );
}
