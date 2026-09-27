import { AppearanceClient } from '@/components/appearance/AppearanceClient';
import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function SystemAppearancePage({ params }: {
  params: Promise<{ locale: 'en' | 'th' }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  await authorizeRoutePage('system.appearance');
  return (
    <AppearanceClient
      locale={locale}
      breadcrumbs={listBreadcrumbs(locale, 'system', 'system.appearance', dict)}
      copy={{
        group: dict['navigation']['groups']['system'],
        title: dict['navigation']['system']['appearance']['label'],
        description: dict['navigation']['system']['appearance']['description'],
      }}
    />
  );
}
