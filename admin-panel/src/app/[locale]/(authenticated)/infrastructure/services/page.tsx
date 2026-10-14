import { ServiceRegistryView } from '@/components/infrastructure/ServiceRegistryView';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { prisma } from '@/lib/prisma';
import { readRegistry } from '@/lib/service-wiring-store';

/**
 * The registry screen. WHY the page reads Prisma itself rather than the read action:
 * a server component is already behind authorizeRoutePage, so routing through the
 * action would add a second permission check without adding a boundary.
 */
export default async function InfrastructureServicesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  await authorizeRoutePage('infrastructure.services');

  const [{ locale }, registry, contests] = await Promise.all([
    params,
    readRegistry(),
    prisma.contests.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } }),
  ]);
  const copy = (await getDictionary(locale)).navigation.infrastructure.services;

  return (
    <ServiceRegistryView
      services={registry.services}
      wirings={registry.wirings}
      exposures={registry.exposures}
      contests={contests}
      title={copy.label}
      description={copy.description}
    />
  );
}
