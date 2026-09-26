import { DeploymentsClient } from '@/components/deployments/DeploymentsClient';
import { getDictionary } from '@/i18n';
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
      locale={locale}
      copy={{
        group: dict['navigation']['groups']['infrastructure'],
        title: dict['navigation']['infrastructure']['deployments']['label'],
        description: dict['navigation']['infrastructure']['deployments']['description'],
      }}
    />
  );
}
