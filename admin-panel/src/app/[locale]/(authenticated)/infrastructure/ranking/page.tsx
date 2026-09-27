import { RankingClient } from '@/components/ranking/RankingClient';
import { getDictionary } from '@/i18n';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function InfrastructureRankingPage({
  params,
}: {
  params: Promise<{ locale: 'en' | 'th' }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const effective = await authorizeRoutePage('infrastructure.ranking');
  return (
    <RankingClient
      permissionKeys={[...effective]}
      breadcrumbs={listBreadcrumbs(locale, 'infrastructure', 'infrastructure.ranking', dict)}
      copy={{
        group: dict['navigation']['groups']['infrastructure'],
        title: dict['navigation']['infrastructure']['ranking']['label'],
        description: dict['navigation']['infrastructure']['ranking']['description'],
      }}
    />
  );
}
