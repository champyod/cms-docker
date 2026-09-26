import { getAdmins } from '@/app/actions/admins';
import { AdminList } from '@/components/admins/AdminList';
import type { AdminCapabilities } from '@/components/admins/adminCapabilities';
import { PageSurface } from '@/components/core/PageSurface';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
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

function adminBreadcrumbs(dict: Dictionary): { label: string }[] {
  return [
    { label: dict['navigation']['groups']['administration'] },
    { label: dict['navigation']['administration']['admins']['label'] },
  ];
}

export default async function AdminsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const effective = await authorizeRoutePage('administration.admins');
  const admins = await getAdmins();
  return (
    <PageSurface
      breadcrumbs={adminBreadcrumbs(dict)}
      title={dict['navigation']['administration']['admins']['label']}
      description={dict.permissions.subtitle}
    >
      <AdminList
        initialAdmins={admins}
        callerPermissions={[...effective]}
        capabilities={adminCapabilities(effective)}
        headerLabels={{ addAdmin: dict.admins.addAdmin }}
        actionLabels={{
          edit: dict.admins.actions.edit,
          delete: dict.admins.actions.delete,
        }}
      />
    </PageSurface>
  );
}
