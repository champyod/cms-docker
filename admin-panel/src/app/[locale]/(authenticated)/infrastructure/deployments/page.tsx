import { DeploymentsClient } from '@/components/deployments/DeploymentsClient';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function InfrastructureDeploymentsPage(): Promise<React.JSX.Element> {
  await authorizeRoutePage('infrastructure.deployments');
  return <DeploymentsClient />;
}