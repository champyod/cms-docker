import { ModuleShell, type ModuleActions, type ModuleDescriptions } from '@/components/navigation/ModuleShell';
import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { buildModuleFields, concealedPermissions } from '@/lib/navigation/module-nav';

const GROUP_ID = 'security';
const FIRST_FIELD_ID = 'security.overview';

export default async function SecurityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const [dict, effective] = await Promise.all([getDictionary(locale), concealedPermissions()]);
  const fields = buildModuleFields(GROUP_ID, locale, dict, effective);
  const descriptions: ModuleDescriptions = {
    'security.overview': dict['navigation']['security']['overview']['description'],
    'security.waf': dict['navigation']['security']['waf']['description'],
    'security.blocks': dict['navigation']['security']['blocks']['description'],
    'security.tls': dict['navigation']['security']['tls']['description'],
  };
  const actionsMap: ModuleActions = {};
  return (
    <ModuleShell
      breadcrumbs={listBreadcrumbs(locale, GROUP_ID, FIRST_FIELD_ID, dict)}
      fields={fields}
      descriptions={descriptions}
      actionsMap={actionsMap}
      fallbackTitle={dict['navigation']['groups'][GROUP_ID]}
    >
      {children}
    </ModuleShell>
  );
}
