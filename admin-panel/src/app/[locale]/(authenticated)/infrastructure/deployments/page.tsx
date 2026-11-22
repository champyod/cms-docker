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

/**
 * The deployed contest stack: which contest each shard serves, the values the stack starts with, and
 * the workers behind it.
 *
 * WHY a board: three record kinds that are not the same record and do not save together - a registry
 * binding per shard, the stack's config.toml values, and the worker fleet - plus one state that
 * belongs to all of them: a deploy in flight, or three sources that disagree about which contest is
 * running. Settings would have claimed one save bar for two independent writes; a list would have had
 * to invent one row set.
 */
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
        title={dict.navigation.infrastructure.deployments.label}
        state={<DeploymentState />}
        sections={sections}
      />
    </DeploymentsProvider>
  );
}
