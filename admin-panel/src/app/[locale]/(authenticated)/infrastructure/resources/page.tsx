import { ResourceView } from '@/components/resources/ResourceView';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function InfrastructureResourcesPage(): Promise<React.JSX.Element> {
  await authorizeRoutePage('infrastructure.resources');
  return <ResourceView />;
}