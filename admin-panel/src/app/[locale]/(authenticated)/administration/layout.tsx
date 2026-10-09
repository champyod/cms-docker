import { ModuleShell, type ModuleActions, type ModuleDescriptions } from '@/components/navigation/ModuleShell';
import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { buildModuleFields, concealedPermissions } from '@/lib/navigation/module-nav';

const GROUP_ID = 'administration';
const ADMINS_FIELD_ID = 'administration.admins';
const GROUPS_FIELD_ID = 'administration.groups';
const AUDIT_FIELD_ID = 'administration.audit';

export default async function AdministrationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const [dict, effective] = await Promise.all([
    getDictionary(locale),
    concealedPermissions(),
  ]);
  const fields = buildModuleFields(GROUP_ID, locale, dict, effective);
  // Only the dictionary knows which page the URL opened and what it is for.
  const descriptions: ModuleDescriptions = {
    [ADMINS_FIELD_ID]: dict.permissions.subtitle,
    [GROUPS_FIELD_ID]: dict['navigation']['administration']['groups']['description'],
    [AUDIT_FIELD_ID]: dict.audit.subtitle,
  };
  // Each panel owns the state its create control acts on, so it publishes its own.
  const actionsMap: ModuleActions = {};
  return (
    <ModuleShell
      breadcrumbs={listBreadcrumbs(locale, GROUP_ID, ADMINS_FIELD_ID, dict)}
      fields={fields}
      descriptions={descriptions}
      actionsMap={actionsMap}
      fallbackTitle={dict['navigation']['groups'][GROUP_ID]}
    >
      {children}
    </ModuleShell>
  );
}
