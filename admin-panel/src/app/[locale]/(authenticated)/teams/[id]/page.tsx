import { notFound } from 'next/navigation';
import { getTeamWithDetails } from '@/app/actions/teams';
import { TeamDetailView } from '@/components/teams/TeamDetailView';

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const teamId = parseInt(id, 10);
  
  if (isNaN(teamId)) {
    notFound();
  }

  const team = await getTeamWithDetails(teamId);

  if (!team) {
    notFound();
  }

  // Serialize dates for client component
  const serializedTeam = {
    ...team,
    contests: team.contests.map(c => ({
      ...c,
      start: c.start.toISOString(),
      stop: c.stop.toISOString(),
    })),
  };

  return (
    <div className="space-y-8">
      <TeamDetailView team={serializedTeam} />
    </div>
  );
}
