import { notFound } from 'next/navigation';

import { checkPermission, getPermissions } from '@/lib/permissions';
import { getDictionary } from '@/i18n';
import { listGroupsWithPermissions } from '@/app/actions/adminPermissions';
import { GroupList } from '@/components/groups/GroupList';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';

export default async function GroupsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const hasPermission = await checkPermission('group:list', false);

  if (!hasPermission) {
    notFound();
  }

  const [groupsResult, effective] = await Promise.all([
    listGroupsWithPermissions(),
    getPermissions(),
  ]);

  const groups = groupsResult.success ? groupsResult.data : [];
  const permissionKeys = Array.from(effective);

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">{dict.groups?.title ?? 'Groups Management'}</Text>
        <Text variant="muted">{dict.groups?.subtitle ?? 'Create and manage permission groups.'}</Text>
      </Stack>

      <GroupList
        groups={groups}
        permissionKeys={permissionKeys}
        dict={dict.groups ?? {
          title: 'Groups Management',
          subtitle: 'Create and manage permission groups.',
          createGroup: 'Create Group',
          editGroup: 'Edit Group',
          name: 'Name',
          description: 'Description',
          isSeeded: 'Seeded',
          permissions: 'Permissions',
          save: 'Save',
          cancel: 'Cancel',
          reasonPlaceholder: 'Reason for this change (required)',
          deleteConfirm: 'Are you sure you want to delete this group? This action cannot be undone.',
          noGroups: 'No groups found',
          noGroupsDescription: 'Create a group to get started.',
          deleteTooltip: 'Delete group',
          editTooltip: 'Edit group',
        }}
      />
    </Stack>
  );
}
