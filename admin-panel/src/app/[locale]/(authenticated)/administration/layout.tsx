import {
  ModuleTabShell,
  type ModuleTabActions,
  type ModuleTabDescriptions,
} from '@/components/navigation/ModuleTabShell';
import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { concealedPermissions } from '@/lib/navigation/module-nav';
import { buildModuleTabs } from '@/lib/navigation/module-tabs';

const GROUP_ID = 'administration';
const ADMINS_TAB_ID = 'administration.admins';
const GROUPS_TAB_ID = 'administration.groups';
const AUDIT_TAB_ID = 'administration.audit';

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
  const tabs = buildModuleTabs(GROUP_ID, locale, dict, effective);
  // Why one line per tab: the title spans every administration page, so only the dictionary
  // knows which of them the URL opened and what that page is for.
  const descriptions: ModuleTabDescriptions = {
    [ADMINS_TAB_ID]: dict.permissions.subtitle,
    [GROUPS_TAB_ID]: dict['navigation']['administration']['groups']['description'],
    [AUDIT_TAB_ID]: dict.audit.subtitle,
  };
  // Why the map stays empty: both administration panels own the state their create control
  // acts on — the one admin modal, the one group form — so each publishes that control into the
  // title slot instead of the layout rebuilding a second copy above it.
  const actionsMap: ModuleTabActions = {};
  return (
    <ModuleTabShell
      breadcrumbs={listBreadcrumbs(locale, GROUP_ID, ADMINS_TAB_ID, dict)}
      title={dict['navigation']['groups'][GROUP_ID]}
      tabs={tabs}
      descriptions={descriptions}
      actionsMap={actionsMap}
    >
      {children}
    </ModuleTabShell>
  );
}