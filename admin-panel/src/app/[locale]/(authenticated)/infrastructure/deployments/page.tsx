import { BoardPage, type BoardSection } from '@/components/patterns/BoardPage';
import {
  ActiveContestSection,
  DeploymentState,
  DeploymentsProvider,
  StackSettingsSave,
  StackSettingsSection,
  WorkersSection,
} from '@/components/deployments/DeploymentsSurface';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function InfrastructureDeploymentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  await authorizeRoutePage('infrastructure.deployments');
  const dict = await getDictionary(locale);
  const sections: readonly BoardSection[] = [
    {
      key: 'active-contest',
      title: 'Contests served per shard',
      description: 'The contest each bound shard serves, read from the service registry: not one active id.',
      rows: <ActiveContestSection />,
    },
    {
      key: 'stack-settings',
      title: 'Contest stack settings',
      description: 'The config.toml values the contest stack reads the next time it starts.',
      actions: <StackSettingsSave />,
      rows: <StackSettingsSection />,
    },
    {
      key: 'workers',
      title: 'Worker nodes',
      description: 'The workers the fleet is configured with, unioned with the ones the monitor reports.',
      rows: <WorkersSection />,
    },
  ];
  return (
    <DeploymentsProvider>
      <BoardPage
        // The infrastructure module shell above renders the title, the description and the trail.
        ownsHeader={false}
        state={<DeploymentState />}
        sections={sections}
      />
    </DeploymentsProvider>
  );
}
