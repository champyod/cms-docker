import { getTeams } from '@/app/actions/teams';
import { TeamList } from '@/components/teams/TeamList';
import { checkPermission, getPermissions } from '@/lib/permissions';
import { getDictionary } from '@/i18n';
import { notFound } from 'next/navigation';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';

export default async function TeamsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const hasPermission = await checkPermission('users', false);

  // Why: return 404 for forbidden access so existence is indistinguishable from missing page
  if (!hasPermission) {
    notFound();
  }

  const permissions = await getPermissions();
  const teams = await getTeams();

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">{dict.teams.title}</Text>
        <Text variant="muted">{dict.teams.subtitle}</Text>
      </Stack>

      <TeamList initialTeams={teams} permissions={permissions} />
    </Stack>
  );
}
