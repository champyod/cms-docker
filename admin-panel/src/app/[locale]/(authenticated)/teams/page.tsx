import { getTeams } from '@/app/actions/teams';
import { TeamList } from '@/components/teams/TeamList';
import { checkPermission } from '@/lib/permissions';
import { getDictionary } from '@/i18n';
import { PermissionDenied } from '@/components/PermissionDenied';
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

  if (!hasPermission) {
    return <PermissionDenied permission="permission_users" locale={locale} dict={dict} />;
  }

  const teams = await getTeams();

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">Teams</Text>
        <Text variant="muted">Manage teams for competitive programming.</Text>
      </Stack>

      <TeamList initialTeams={teams} />
    </Stack>
  );
}
