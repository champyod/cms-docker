import { notFound } from 'next/navigation';

import { ShieldAlert } from 'lucide-react';

import { getAdmins } from '@/app/actions/admins';
import { listGroupsWithPermissions } from '@/app/actions/adminPermissions';
import { AdminList } from '@/components/admins/AdminList';
import type { AdminCapabilities } from '@/components/admins/adminCapabilities';
import { GroupList } from '@/components/groups/GroupList';
import { EmptyState } from '@/components/core/EmptyState';
import { Stack } from '@/components/core/Layout';
import { Tabs, type TabItem } from '@/components/core/Tabs';
import { Text } from '@/components/core/Typography';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { getPermissions } from '@/lib/permissions';
import { permittedTabs, resolvePermissionTab } from '@/lib/permission-tabs';

async function renderAdminsTab(
  effective: ReadonlySet<string>,
  dict: Dictionary,
): Promise<React.JSX.Element> {
  // Why: the tab gate is admin:list, which does not imply admin:read, and getAdmins() rejects a caller
  // without admin:read; a list-only caller gets an explanation rather than a page-level failure.
  if (!hasEffectivePermission(effective, 'admin:read')) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title={dict.permissions.adminsRestricted.title}
        description={dict.permissions.adminsRestricted.description}
      />
    );
  }

  const admins = await getAdmins();

  // Why: capabilities are derived from the caller's own effective keys, never from the tab gate, so the
  // control surface matches what each server action will actually allow.
  const capabilities: AdminCapabilities = {
    canCreate: hasEffectivePermission(effective, 'admin:create'),
    canUpdate: hasEffectivePermission(effective, 'admin:update'),
    canDelete: hasEffectivePermission(effective, 'admin:delete'),
    canSetPassword: hasEffectivePermission(effective, 'admin:password:update'),
    canRevealPassword: hasEffectivePermission(effective, 'password:reveal'),
  };

  return (
    <AdminList
      initialAdmins={admins}
      callerPermissions={[...effective]}
      capabilities={capabilities}
      headerLabels={{ title: dict.admins.title, addAdmin: dict.admins.addAdmin }}
      actionLabels={{ edit: dict.admins.actions.edit, delete: dict.admins.actions.delete }}
    />
  );
}

async function renderGroupsTab(
  effective: ReadonlySet<string>,
  dict: Dictionary,
): Promise<React.JSX.Element> {
  // Why: the list action additionally requires group:read, so a caller holding only group:list gets the
  // empty state rather than a denied action surfacing as a page error.
  const groupsResult = await listGroupsWithPermissions();

  return (
    <GroupList
      groups={groupsResult.success ? groupsResult.data : []}
      permissionKeys={[...effective]}
      dict={dict.groups}
    />
  );
}

export default async function PermissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const effective = await getPermissions();
  const permitted = permittedTabs(effective);
  const activeTab = resolvePermissionTab((await searchParams).tab, permitted);

  // Why: return 404 when the caller can read neither tab so existence is indistinguishable from a missing page
  if (!activeTab) {
    notFound();
  }

  const tabItems: TabItem[] = permitted.map((tab) => ({
    id: tab,
    label: dict.permissions.tabs[tab],
    href: `/${locale}/permissions?tab=${tab}`,
  }));

  const content =
    activeTab === 'admins'
      ? await renderAdminsTab(effective, dict)
      : await renderGroupsTab(effective, dict);

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">{dict.permissions.title}</Text>
        <Text variant="muted">{dict.permissions.subtitle}</Text>
      </Stack>

      <Stack gap={6}>
        <Tabs items={tabItems} activeId={activeTab} ariaLabel={dict.permissions.tabs.label} />
        {content}
      </Stack>
    </Stack>
  );
}
