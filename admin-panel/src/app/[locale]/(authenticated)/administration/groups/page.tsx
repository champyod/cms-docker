import { listGroupsWithPermissions } from '@/app/actions/adminPermissions';
import { PageSurface } from '@/components/core/PageSurface';
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
  const groupLabel = dict['navigation']['administration']['groups']['label'];
  return (
    <PageSurface
      breadcrumbs={[
        { label: dict['navigation']['groups']['administration'] },
        { label: groupLabel },
      ]}
      title={groupLabel}
      status={result.success ? { kind: 'idle' } : {
        kind: 'error',
        title: dict.groups.loadFailed,
        description: result.error,
      }}
    >
      {result.success ? (
        <GroupList
          groups={result.data}
          permissionKeys={[...effective]}
          dict={dict.groups}
        />
      ) : null}
    </PageSurface>
  );
}
