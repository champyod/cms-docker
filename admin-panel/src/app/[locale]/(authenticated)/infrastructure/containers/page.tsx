import { ContainersClient } from '@/components/containers/ContainersClient';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function InfrastructureContainersPage(): Promise<React.JSX.Element> {
  await authorizeRoutePage('infrastructure.containers');
  return <ContainersClient />;
}