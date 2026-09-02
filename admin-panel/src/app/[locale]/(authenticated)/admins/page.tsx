import { getAdmins } from '@/app/actions/admins';
import { AdminList } from '@/components/admins/AdminList';
import { checkPermission } from '@/lib/permissions';
import { getDictionary } from '@/i18n';
import { notFound } from 'next/navigation';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';

export default async function AdminsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const hasPermission = await checkPermission('all', false);

  // Why: return 404 for forbidden access so existence is indistinguishable from missing page
  if (!hasPermission) {
    notFound();
  }

  const admins = await getAdmins();

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">{dict.admins.title}</Text>
        <Text variant="muted">{dict.admins.subtitle}</Text>
      </Stack>

      <AdminList
        initialAdmins={admins}
        actionLabels={{ edit: dict.admins.actions.edit, delete: dict.admins.actions.delete }}
      />
    </Stack>
  );
}
