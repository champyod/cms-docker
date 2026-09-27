import { MaintenanceClient } from '@/components/system/MaintenanceClient';
import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function SystemMaintenancePage({ params }: {
  params: Promise<{ locale: 'en' | 'th' }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const effective = await authorizeRoutePage('system.maintenance');
  return (
    <MaintenanceClient
      locale={locale}
      permissionKeys={[...effective]}
      breadcrumbs={listBreadcrumbs(locale, 'system', 'system.maintenance', dict)}
      copy={{
        group: dict['navigation']['groups']['system'],
        title: dict['navigation']['system']['maintenance']['label'],
        description: dict['navigation']['system']['maintenance']['description'],
      }}
    />
  );
}
