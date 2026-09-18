import { getAdmins } from '@/app/actions/admins';
import { AdminList } from '@/components/admins/AdminList';
import { checkPermission, getPermissions } from '@/lib/permissions';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { getDictionary } from '@/i18n';
import { notFound } from 'next/navigation';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import type { AdminCapabilities } from '@/components/admins/AdminPanelCard';

export default async function AdminsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const hasPermission = await checkPermission('admin:list', false);

  // Why: return 404 for forbidden access so existence is indistinguishable from missing page
  if (!hasPermission) {
    notFound();
  }

  const admins = await getAdmins();
  const permissions = await getPermissions();

  // Why: capabilities are derived from the caller's own effective keys, never from the page gate, so the
  // control surface matches what each server action will actually allow.
  const capabilities: AdminCapabilities = {
    canCreate: hasEffectivePermission(permissions, 'admin:create'),
    canUpdate: hasEffectivePermission(permissions, 'admin:update'),
    canDelete: hasEffectivePermission(permissions, 'admin:delete'),
    canSetPassword: hasEffectivePermission(permissions, 'admin:password:update'),
    canRevealPassword: hasEffectivePermission(permissions, 'password:reveal'),
  };

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">{dict.admins.title}</Text>
        <Text variant="muted">{dict.admins.subtitle}</Text>
      </Stack>

      <AdminList
        initialAdmins={admins}
        callerPermissions={[...permissions]}
        capabilities={capabilities}
        panelLabels={{
          title: dict.admins.panel.title,
          addAdmin: dict.admins.panel.addAdmin,
          expand: dict.admins.panel.expand,
          collapse: dict.admins.panel.collapse,
        }}
        actionLabels={{ edit: dict.admins.actions.edit, delete: dict.admins.actions.delete }}
      />
    </Stack>
  );
}
