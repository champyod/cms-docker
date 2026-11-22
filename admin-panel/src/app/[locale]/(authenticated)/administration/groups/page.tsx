import { listGroupsWithPermissions } from '@/app/actions/adminPermissions';
import { SurfaceState } from '@/components/core/SurfaceState';
import { GroupList } from '@/components/groups/GroupList';
import { ListPage } from '@/components/patterns/ListPage';
import { getDictionary } from '@/i18n';
import { readListSort } from '@/lib/list-sorting';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

/**
 * The permission groups, one record kind with one row shape.
 *
 * WHY a list and not a board: the only thing that sits beside a group is the number of permissions
 * it carries, and that is a fact about its own row. A second section would either repeat the rows
 * or pull the permissions out of the row naming the group they belong to.
 *
 * WHY no filter and no total: `listGroupsWithPermissions` returns every group in one pass, so there
 * is no narrower set to narrow to and nothing left out to count against the rows shown.
 */
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
    // The read failed, so there are no rows to lay out: rendering the list anyway would put
    // "no groups" over a failure and claim the deployment has none.
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
    <ListPage
      // The module shell above renders the title, the description and the trail.
      ownsHeader={false}
    >
      <GroupList
        groups={result.data}
        permissionKeys={[...effective]}
        dict={dict.groups}
        sort={sort}
      />
    </ListPage>
  );
}
