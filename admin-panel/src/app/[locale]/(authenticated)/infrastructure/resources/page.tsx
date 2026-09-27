import { ResourceView } from '@/components/resources/ResourceView';
import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
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
      breadcrumbs={listBreadcrumbs(locale, 'infrastructure', 'infrastructure.resources', dict)}
      copy={{
        title: dict['navigation']['infrastructure']['resources']['label'],
        description: dict['navigation']['infrastructure']['resources']['description'],
      }}
    />
  );
}
