import { listGroupsWithPermissions } from '@/app/actions/adminPermissions';
import { SurfaceState } from '@/components/core/SurfaceState';
import { GroupList } from '@/components/groups/GroupList';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function GroupsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const effective = await authorizeRoutePage('administration.groups');
  const result = await listGroupsWithPermissions();
  if (!result.success) {
    return (
      <SurfaceState
        status={{
          kind: 'error',
          title: dict.groups.loadFailed,
          description: result.error,
        }}
      />
    );
  }
  return (
    <GroupList
      groups={result.data}
      permissionKeys={[...effective]}
      dict={dict.groups}
    />
  );
}
