import { InfrastructureTabDescription } from '@/components/infrastructure/InfrastructureTabDescription';
import {
  ModuleTabShell,
  type ModuleTabActions,
} from '@/components/navigation/ModuleTabShell';
import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { concealedPermissions } from '@/lib/navigation/module-nav';
import { buildModuleTabs } from '@/lib/navigation/module-tabs';

const GROUP_ID = 'infrastructure';
const DEPLOYMENTS_TAB_ID = 'infrastructure.deployments';

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
  const tabs = buildModuleTabs(GROUP_ID, locale, dict, effective);
  const tabDescriptions: Readonly<Record<string, string>> = {
    'infrastructure.deployments': dict['navigation']['infrastructure']['deployments']['description'],
    'infrastructure.containers': dict['navigation']['infrastructure']['containers']['description'],
    'infrastructure.resources': dict['navigation']['infrastructure']['resources']['description'],
    'infrastructure.ranking': dict['navigation']['infrastructure']['ranking']['description'],
  };
  // Why the map stays empty: every infrastructure control is bound to state its own tab panel
  // owns — a live-stream status, a compose or deploy read — and this layout renders above that
  // client state, so each panel publishes its own actions into the title slot instead.
  const actionsMap: ModuleTabActions = {};
  return (
    <ModuleTabShell
      breadcrumbs={listBreadcrumbs(locale, GROUP_ID, DEPLOYMENTS_TAB_ID, dict)}
      title={dict['navigation']['groups'][GROUP_ID]}
      description={<InfrastructureTabDescription tabs={tabs} descriptions={tabDescriptions} />}
      tabs={tabs}
      actionsMap={actionsMap}
    >
      {children}
    </ModuleTabShell>
  );
}