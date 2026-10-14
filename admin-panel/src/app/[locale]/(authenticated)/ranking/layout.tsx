import { ModuleShell, type ModuleActions, type ModuleDescriptions } from '@/components/navigation/ModuleShell';
import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { buildModuleFields, concealedPermissions } from '@/lib/navigation/module-nav';

const GROUP_ID = 'ranking';
const BOARD_FIELD_ID = 'ranking.board';

export default async function RankingLayout({
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
    'ranking.board': dict['navigation']['ranking']['board']['description'],
    'ranking.users': dict['navigation']['ranking']['users']['description'],
    'ranking.settings': dict['navigation']['ranking']['settings']['description'],
    'ranking.appearance': dict['navigation']['ranking']['appearance']['description'],
    'ranking.credits': dict['navigation']['ranking']['credits']['description'],
  };
  // Every control is bound to state its own page owns, so each publishes its own.
  const actionsMap: ModuleActions = {};
  return (
    <ModuleShell
      breadcrumbs={listBreadcrumbs(locale, GROUP_ID, BOARD_FIELD_ID, dict)}
      fields={fields}
      descriptions={descriptions}
      actionsMap={actionsMap}
      fallbackTitle={dict['navigation']['groups'][GROUP_ID]}
    >
      {children}
    </ModuleShell>
  );
}
