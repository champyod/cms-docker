import { listGroupsWithPermissions } from '@/app/actions/adminPermissions';
import { SurfaceState } from '@/components/core/SurfaceState';
import { GroupList } from '@/components/groups/GroupList';
import { getDictionary } from '@/i18n';
import { readListSort } from '@/lib/list-sorting';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function GroupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sort?: string; dir?: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const query = await searchParams;
  const dict = await getDictionary(locale);
  const effective = await authorizeRoutePage('administration.groups');
  const sort = readListSort({ sort: query.sort, dir: query.dir });
  const result = await listGroupsWithPermissions(sort);
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
      sort={sort}
    />
  );
}
