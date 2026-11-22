import { notFound } from 'next/navigation';
import { getDictionary } from '@/i18n';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { getContestParticipants } from '@/lib/queries/contest-detail';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { BoardPage } from '@/components/patterns/BoardPage';
import { ContestParticipantsTab } from '@/components/contests/contest-detail/ContestParticipantsTab';
import { ContestRosterSection } from '@/components/contests/contest-detail/ContestRosterSection';

type ContestRouteProps = {
  params: Promise<{ locale: string; id: string }>;
};

// Why: the reader enforces the same keys, but the page must resolve the exact
// registry route first so a disabled or narrowed descriptor 404s before data.
async function authorizeContestTab(routeId: RouteId): Promise<ReadonlySet<string>> {
  const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
  if (!route || !route.enabled) notFound();
  try {
    let effective: ReadonlySet<string> = new Set<string>();
    for (const key of route.permission.all ?? []) effective = await requirePermission(key);
    if (!isRoutePermitted(route, effective)) notFound();
    return effective;
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
}

export default async function ContestParticipantsPage({ params }: ContestRouteProps): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  const contestId = parseRecordId(id);
  if (contestId === null) notFound();
  const effective = await authorizeContestTab('contests.tabs.participants');
  const dictionary = await getDictionary(locale);
  const data = await readRecordOrNotFound(() => getContestParticipants(contestId));
  const count = data.participations.length;
  return (
    <BoardPage
      // The record shell above renders the contest's name, its trail and its tabs.
      ownsHeader={false}
      title="Participants"
      sections={[
        {
          key: 'participants',
          title: 'Participants',
          description: `${count} ${count === 1 ? 'participant' : 'participants'} in this contest, with the actions each row allows.`,
          rows: <ContestParticipantsTab data={data} />,
        },
        {
          // Why its own section: a participation and a roster row are different records that
          // answer different questions, and each has its own meaning of empty. Filing them under
          // one heading made the roster read as more participants.
          key: 'roster',
          title: dictionary.contests.roster.title,
          description: dictionary.contests.roster.description,
          rows: <ContestRosterSection contestId={data.contestId} permissionKeys={[...effective]} />,
        },
      ]}
    />
  );
}
