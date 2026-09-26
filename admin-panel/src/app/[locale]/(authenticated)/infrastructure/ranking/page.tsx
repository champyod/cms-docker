import { RankingClient } from '@/components/ranking/RankingClient';
import { getDictionary } from '@/i18n';
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
      locale={locale}
      permissionKeys={[...effective]}
      copy={{
        group: dict['navigation']['groups']['infrastructure'],
        title: dict['navigation']['infrastructure']['ranking']['label'],
        description: dict['navigation']['infrastructure']['ranking']['description'],
      }}
    />
  );
}
