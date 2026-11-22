import { PreviewPanel } from '@/components/infrastructure/PreviewPanel';
import { RegistryKindSection } from '@/components/infrastructure/RegistryKindSection';
import { RegistryProblems } from '@/components/infrastructure/RegistryProblems';
import { BoardPage, type BoardSection } from '@/components/patterns/BoardPage';
import { getDictionary } from '@/i18n';
import { readFrontVhosts } from '@/lib/front-vhosts';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { getPermissions } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { collectWiringProblems } from '@/lib/service-wiring-problems';
import { readRegistry } from '@/lib/service-wiring-store';

/**
 * The registry screen.
 *
 * WHY the page reads Prisma itself rather than the read action: a server component is already
 * behind authorizeRoutePage, so routing through the action would add a second permission check
 * without adding a boundary.
 *
 * WHY a board and not tabs: a service, a wiring and an exposure are three record kinds with three
 * different row shapes and three different meanings of empty, and a tab strip hid two of them
 * behind a click. The board states all three at once — which is the question the operator actually
 * asks ("does this deployment hang together?") — and keeps the generated artifacts beside them as
 * the answer a sync would write.
 */
export default async function InfrastructureServicesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  await authorizeRoutePage('infrastructure.services');

  const [{ locale }, registry, contests, permissions, frontVhosts] = await Promise.all([
    params,
    readRegistry(),
    prisma.contests.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    getPermissions(),
    readFrontVhosts(),
  ]);
  const dict = await getDictionary(locale);
  const copy = dict.infrastructure.services;
  const permissionKeys = [...permissions];
  // The same predicate the renderer refuses a sync on, so the strip and the write cannot disagree.
  const problems = collectWiringProblems(registry.services, registry.wirings, registry.exposures, frontVhosts);

  const sections: readonly BoardSection[] = [
    {
      key: 'services',
      title: copy.kinds.service,
      count: registry.services.length,
      description: copy.kinds.serviceHint,
      rows: (
        <RegistryKindSection
          kind="service"
          services={registry.services}
          wirings={registry.wirings}
          exposures={registry.exposures}
          contests={contests}
          permissionKeys={permissionKeys}
          frontVhosts={frontVhosts}
        />
      ),
    },
    {
      key: 'wirings',
      title: copy.kinds.wiring,
      count: registry.wirings.length,
      description: copy.kinds.wiringHint,
      rows: (
        <RegistryKindSection
          kind="wiring"
          services={registry.services}
          wirings={registry.wirings}
          exposures={registry.exposures}
          contests={contests}
          permissionKeys={permissionKeys}
          frontVhosts={frontVhosts}
        />
      ),
    },
    {
      key: 'exposures',
      title: copy.kinds.exposure,
      count: registry.exposures.length,
      description: copy.kinds.exposureHint,
      rows: (
        <RegistryKindSection
          kind="exposure"
          services={registry.services}
          wirings={registry.wirings}
          exposures={registry.exposures}
          contests={contests}
          permissionKeys={permissionKeys}
          frontVhosts={frontVhosts}
        />
      ),
    },
    {
      key: 'preview',
      title: copy.preview.title,
      description: copy.preview.description,
      rows: <PreviewPanel />,
    },
  ];

  return (
    <BoardPage
      // The infrastructure module shell renders this page's name, description and trail from the
      // navigation registry, so the page supplies its state and its sections.
      ownsHeader={false}
      state={problems.length > 0 ? <RegistryProblems problems={problems} copy={copy} /> : undefined}
      sections={sections}
    />
  );
}
