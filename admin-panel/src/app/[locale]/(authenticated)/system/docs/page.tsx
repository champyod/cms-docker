import { Book } from 'lucide-react';

import { PageSurface } from '@/components/core/PageSurface';
import { DocsContent } from '@/components/docs/DocsContent';
import { getDictionary } from '@/i18n';

export default async function SystemDocsPage({ params }: {
  params: Promise<{ locale: 'en' | 'th' }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  return (
    <PageSurface
      breadcrumbs={[
        { label: dict['navigation']['groups']['system'] },
        { label: dict['navigation']['system']['docs']['label'] },
      ]}
      title={dict['navigation']['system']['docs']['label']}
      description={dict.docs.subtitle}
      actions={(
        <a
          href="https://cms-dev.github.io/cms/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center gap-2 rounded-lg bg-secondary px-4 py-2 text-foreground transition-colors hover:bg-secondary/80"
        >
          <Book className="h-4 w-4" />
          {dict.docs.officialDocs}
        </a>
      )}
    >
      <DocsContent />
    </PageSurface>
  );
}
