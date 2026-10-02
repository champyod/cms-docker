import { MaintenanceClient } from '@/components/system/MaintenanceClient';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function SystemMaintenancePage({ params }: {
  params: Promise<{ locale: 'en' | 'th' }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const effective = await authorizeRoutePage('system.maintenance');
  return <MaintenanceClient locale={locale} permissionKeys={[...effective]} />;
}