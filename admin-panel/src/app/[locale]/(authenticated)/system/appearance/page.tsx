import { AppearanceClient } from '@/components/appearance/AppearanceClient';
import { getDictionary } from '@/i18n';
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
      copy={{
        group: dict['navigation']['groups']['system'],
        title: dict['navigation']['system']['appearance']['label'],
        description: dict['navigation']['system']['appearance']['description'],
      }}
    />
  );
}
