import { PageSurface } from '@/components/core/PageSurface';
import { EnvConfigView } from '@/components/settings/EnvConfigView';
import { MonitorConfigSection } from '@/components/settings/MonitorConfigSection';
import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function SystemSettingsPage({ params }: {
  params: Promise<{ locale: 'en' | 'th' }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  await authorizeRoutePage('system.settings');
  return (
    <PageSurface
      breadcrumbs={listBreadcrumbs(locale, 'system', 'system.settings', dict)}
      title={dict['navigation']['system']['settings']['label']}
      description={dict.settings.subtitle}
    >
      <EnvConfigView />
      <MonitorConfigSection />
    </PageSurface>
  );
}
