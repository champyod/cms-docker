import { Book } from 'lucide-react';

import { ModuleShell, type ModuleActions, type ModuleDescriptions } from '@/components/navigation/ModuleShell';
import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { buildModuleFields, concealedPermissions } from '@/lib/navigation/module-nav';

const GROUP_ID = 'system';
const APPEARANCE_FIELD_ID = 'system.appearance';
const DOCS_FIELD_ID = 'system.docs';

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
  const fields = buildModuleFields(GROUP_ID, locale, dict, effective);
  const systemNav = dict['navigation']['system'];
  // Only the dictionary knows which page the URL opened and what it is for.
  const descriptions: ModuleDescriptions = {
    [APPEARANCE_FIELD_ID]: systemNav['appearance']['description'],
    'system.maintenance': systemNav['maintenance']['description'],
    'system.backup-restore': systemNav['backup-restore']['description'],
    'system.settings': systemNav['settings']['description'],
    [DOCS_FIELD_ID]: dict.docs.subtitle,
    'system.about': systemNav['about']['description'],
  };
  // A field whose action needs no panel state contributes it here.
  const actionsMap: ModuleActions = {
    [DOCS_FIELD_ID]: (
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
    <ModuleShell
      breadcrumbs={listBreadcrumbs(locale, GROUP_ID, APPEARANCE_FIELD_ID, dict)}
      fields={fields}
      descriptions={descriptions}
      actionsMap={actionsMap}
      fallbackTitle={dict['navigation']['groups'][GROUP_ID]}
    >
      {children}
    </ModuleShell>
  );
}
