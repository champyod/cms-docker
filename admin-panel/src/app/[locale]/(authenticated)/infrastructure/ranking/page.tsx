import { RankingClient } from '@/components/ranking/RankingClient';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function InfrastructureRankingPage(): Promise<React.JSX.Element> {
  const effective = await authorizeRoutePage('infrastructure.ranking');
  return <RankingClient permissionKeys={[...effective]} />;
}