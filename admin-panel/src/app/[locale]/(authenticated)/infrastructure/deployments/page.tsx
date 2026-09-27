import { DeploymentsClient } from '@/components/deployments/DeploymentsClient';
import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function InfrastructureDeploymentsPage({
  params,
}: {
  params: Promise<{ locale: 'en' | 'th' }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  await authorizeRoutePage('infrastructure.deployments');
  return (
    <DeploymentsClient
      breadcrumbs={listBreadcrumbs(locale, 'infrastructure', 'infrastructure.deployments', dict)}
      copy={{
        group: dict['navigation']['groups']['infrastructure'],
        title: dict['navigation']['infrastructure']['deployments']['label'],
        description: dict['navigation']['infrastructure']['deployments']['description'],
      }}
    />
  );
}
