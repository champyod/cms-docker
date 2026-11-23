import { BoardPage, type BoardSection } from '@/components/patterns/BoardPage';
import {
  CoreServicesSection,
  CountersSection,
  MetricsSection,
  ResourceWorkersSection,
  ResourcesProvider,
  TrafficSection,
} from '@/components/resources/ResourceView';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

/**
 * What this host is doing: its services, its CPU and memory, its workers, its counters and the
 * traffic the proxy logged.
 *
 * WHY a board: five readings that share no row shape and no meaning of empty - a service's state, a
 * percentage, a worker endpoint, a set of totals and a log line - each read on a track of its own.
 * A list would have had to invent one row set, one filter and one total across the five; a dashboard
 * would have put counts above sections that are not counts.
 *
 * WHY no page-level state and no page-level freshness: each section carries the cue that says when
 * its own value was read, and the panel deliberately has no live badge - a stream that stops is
 * marked where the reader is looking, in the section that stopped moving. Both are named in the
 * inventory rather than filled with a placeholder.
 */
export default async function InfrastructureResourcesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  await authorizeRoutePage('infrastructure.resources');
  const dict = await getDictionary(locale);
  const sections: readonly BoardSection[] = [
    {
      key: 'services',
      title: dict.resources.title,
      description: 'The services that answer for this deployment, and whether each is up.',
      rows: <CoreServicesSection />,
    },
    {
      key: 'counters',
      title: 'CPU and memory',
      description: 'The host’s own two figures, each with the source the reading came from.',
      rows: <CountersSection />,
    },
    {
      key: 'workers',
      title: dict.resources.workerNodes,
      description: 'The worker fleet as the monitor reports it, or the reason it could not be read.',
      rows: <ResourceWorkersSection />,
    },
    {
      key: 'metrics',
      title: dict.resources.systemMetrics,
      description: 'Uptime, load average and the network totals since the host started.',
      rows: <MetricsSection />,
    },
    {
      key: 'traffic',
      title: 'Network traffic',
      description: 'The newest lines the proxy logged, and how many of them to keep on screen.',
      rows: <TrafficSection />,
    },
  ];
  return (
    <ResourcesProvider>
      <BoardPage
        // The infrastructure module shell above renders the title, the description and the trail.
        ownsHeader={false}
        sections={sections}
      />
    </ResourcesProvider>
  );
}
