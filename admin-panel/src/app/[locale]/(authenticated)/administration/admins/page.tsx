import { getAdmins } from '@/app/actions/admins';
import { AdminList } from '@/components/admins/AdminList';
import type { AdminCapabilities } from '@/components/admins/adminCapabilities';
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
  );
}
