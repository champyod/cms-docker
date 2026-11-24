import { ContainerRows, ContainerStacks, ContainerStats, ContainersProvider } from '@/components/containers/ContainersSurface';
import { ListPage } from '@/components/patterns/ListPage';
import { getDictionary } from '@/i18n';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

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
        toolbar={<ContainerStats />}
        footer={<ContainerStacks />}
      >
        <ContainerRows />
      </ListPage>
    </ContainersProvider>
  );
}
