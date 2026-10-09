import { ModuleShell, type ModuleActions, type ModuleDescriptions } from '@/components/navigation/ModuleShell';
import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { buildModuleFields, concealedPermissions } from '@/lib/navigation/module-nav';

const GROUP_ID = 'infrastructure';
const DEPLOYMENTS_FIELD_ID = 'infrastructure.deployments';

export default async function InfrastructureLayout({
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
  const descriptions: ModuleDescriptions = {
    'infrastructure.deployments': dict['navigation']['infrastructure']['deployments']['description'],
    'infrastructure.containers': dict['navigation']['infrastructure']['containers']['description'],
    'infrastructure.resources': dict['navigation']['infrastructure']['resources']['description'],
    'infrastructure.ranking': dict['navigation']['infrastructure']['ranking']['description'],
  };
  // Every control is bound to state its own panel owns, so each publishes its own.
  const actionsMap: ModuleActions = {};
  return (
    <ModuleShell
      breadcrumbs={listBreadcrumbs(locale, GROUP_ID, DEPLOYMENTS_FIELD_ID, dict)}
      fields={fields}
      descriptions={descriptions}
      actionsMap={actionsMap}
      fallbackTitle={dict['navigation']['groups'][GROUP_ID]}
    >
      {children}
    </ModuleShell>
  );
}
