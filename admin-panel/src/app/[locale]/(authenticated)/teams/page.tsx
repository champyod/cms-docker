import { getTeams } from '@/app/actions/teams';
import { TeamList } from '@/components/teams/TeamList';

export default async function TeamsPage() {
  const teams = await getTeams();

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Teams
        </h1>
        <p className="text-neutral-400">
          Manage teams for competitive programming.
        </p>
      </div>

      <TeamList initialTeams={teams} />
    </div>
  );
}
