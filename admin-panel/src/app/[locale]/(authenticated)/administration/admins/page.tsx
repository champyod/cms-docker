import { getAdmins } from '@/app/actions/admins';
import { AdminList } from '@/components/admins/AdminList';
import type { AdminCapabilities } from '@/components/admins/adminCapabilities';
import { ListPage } from '@/components/patterns/ListPage';
import { getDictionary } from '@/i18n';
import { readListSort } from '@/lib/list-sorting';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { hasEffectivePermission } from '@/lib/permission-engine';

function adminCapabilities(effective: ReadonlySet<string>): AdminCapabilities {
  // Why: capabilities come from the caller's own effective keys, never from the
  // route gate, so the control surface matches what each server action allows.
  return {
    canCreate: hasEffectivePermission(effective, 'admin:create'),
    canUpdate: hasEffectivePermission(effective, 'admin:update'),
    canDelete: hasEffectivePermission(effective, 'admin:delete'),
    canSetPassword: hasEffectivePermission(effective, 'admin:password:update'),
    canRevealPassword: hasEffectivePermission(effective, 'password:reveal'),
  };
}

/**
 * The administrators, one record kind with one row shape.
 *
 * WHY a list and not a board: the page's second table of facts — the groups each admin holds and
 * the overrides written for them — is read per admin and lands in that admin's own row. A board
 * section for it would either repeat the rows or pull the groups out of the row that names the
 * person they belong to, and neither tells the operator anything the joined table does not.
 */
export default async function AdminsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sort?: string; dir?: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const query = await searchParams;
  const dict = await getDictionary(locale);
  const effective = await authorizeRoutePage('administration.admins');
  const sort = readListSort({ sort: query.sort, dir: query.dir });
  const admins = await getAdmins(sort);
  return (
    <ListPage
      // The module shell above renders the title, the description and the trail.
      ownsHeader={false}
      breadcrumbs={[]}
      title={dict.admins.title}
      description={dict.permissions.subtitle}
    >
      <AdminList
        initialAdmins={admins}
        initialSort={sort}
        callerPermissions={[...effective]}
        capabilities={adminCapabilities(effective)}
        actionLabels={{
          edit: dict.admins.actions.edit,
          delete: dict.admins.actions.delete,
        }}
      />
    </ListPage>
  );
}
