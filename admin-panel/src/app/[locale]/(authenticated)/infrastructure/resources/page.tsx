import { ResourceView } from '@/components/resources/ResourceView';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function InfrastructureResourcesPage({
  params,
}: {
  params: Promise<{ locale: 'en' | 'th' }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  await authorizeRoutePage('infrastructure.resources');
  return (
    <ResourceView
      copy={{
        group: dict['navigation']['groups']['infrastructure'],
        title: dict['navigation']['infrastructure']['resources']['label'],
        description: dict['navigation']['infrastructure']['resources']['description'],
      }}
    />
  );
}
