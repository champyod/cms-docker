import { Book } from 'lucide-react';

import {
  ModuleTabShell,
  type ModuleTabActions,
  type ModuleTabDescriptions,
} from '@/components/navigation/ModuleTabShell';
import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { concealedPermissions } from '@/lib/navigation/module-nav';
import { buildModuleTabs } from '@/lib/navigation/module-tabs';

const GROUP_ID = 'system';
const APPEARANCE_TAB_ID = 'system.appearance';
const DOCS_TAB_ID = 'system.docs';

export default async function SystemLayout({
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
  const systemNav = dict['navigation']['system'];
  // Why one line per tab: the title spans every system page, so only the dictionary knows
  // which of them the URL opened and what that page is for.
  const descriptions: ModuleTabDescriptions = {
    [APPEARANCE_TAB_ID]: systemNav['appearance']['description'],
    'system.maintenance': systemNav['maintenance']['description'],
    'system.settings': systemNav['settings']['description'],
    [DOCS_TAB_ID]: dict.docs.subtitle,
  };
  // Why keyed by tab id: the header renders the one action the active tab id names, so
  // a tab whose action needs no panel state contributes it here, and the tabs that own
  // live state publish theirs into the title slot instead of appearing twice.
  const actionsMap: ModuleTabActions = {
    [DOCS_TAB_ID]: (
      <a
        href="https://cms-dev.github.io/cms/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-11 items-center gap-2 rounded-lg bg-secondary px-4 py-2 text-foreground transition-colors hover:bg-secondary/80"
      >
        <Book className="h-4 w-4" />
        {dict.docs.officialDocs}
      </a>
    ),
  };
  return (
    <ModuleTabShell
      breadcrumbs={listBreadcrumbs(locale, GROUP_ID, APPEARANCE_TAB_ID, dict)}
      title={dict['navigation']['groups'][GROUP_ID]}
      tabs={tabs}
      descriptions={descriptions}
      actionsMap={actionsMap}
    >
      {children}
    </ModuleTabShell>
  );
}