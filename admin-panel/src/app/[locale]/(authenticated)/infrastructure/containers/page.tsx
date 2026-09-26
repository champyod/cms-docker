import { ContainersClient } from '@/components/containers/ContainersClient';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function InfrastructureContainersPage({
  params,
}: {
  params: Promise<{ locale: 'en' | 'th' }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  await authorizeRoutePage('infrastructure.containers');
  return (
    <ContainersClient
      copy={{
        group: dict['navigation']['groups']['infrastructure'],
        title: dict['navigation']['infrastructure']['containers']['label'],
        description: dict['navigation']['infrastructure']['containers']['description'],
      }}
    />
  );
}
