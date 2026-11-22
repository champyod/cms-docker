import { ContainerRows, ContainerStacks, ContainerStats, ContainersProvider } from '@/components/containers/ContainersSurface';
import { ListPage } from '@/components/patterns/ListPage';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

/**
 * The running containers: how many, which, and what can be done to one or to a group.
 *
 * WHY a list: one row set, a per-row action set, a selection acted on in bulk and a meaning of empty
 * - "the stream has not reported a container". The counts describe that row set rather than being a
 * page of their own, so they sit above the rows as the list's toolbar; the stack controls act on
 * groups of the same rows, so they sit below them.
 *
 * WHY the page supplies no filter and no total against a whole: the stream reports every container
 * the host runs, in one pass. A filter would be a new read this page does not have, and a total that
 * differs from the rows shown would be a number it cannot stand behind.
 */
export default async function InfrastructureContainersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  await authorizeRoutePage('infrastructure.containers');
  const dict = await getDictionary(locale);
  return (
    <ContainersProvider>
      <ListPage
        // The infrastructure module shell above renders the title, the description and the trail.
        ownsHeader={false}
        title={dict.navigation.infrastructure.containers.label}
        toolbar={<ContainerStats />}
        footer={<ContainerStacks />}
      >
        <ContainerRows />
      </ListPage>
    </ContainersProvider>
  );
}
