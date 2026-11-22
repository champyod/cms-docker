import { notFound } from 'next/navigation';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { parseRecordId } from '@/lib/queries/record-access';
import { getDictionary } from '@/i18n';
import { BoardPage } from '@/components/patterns/BoardPage';
import { ContestRankingTab } from '@/components/contests/contest-detail/ContestRankingTab';

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

export default async function ContestRankingPage({ params }: ContestRouteProps): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  const contestId = parseRecordId(id);
  if (contestId === null) notFound();
  await authorizeContestTab('contests.tabs.ranking');
  const copy = (await getDictionary(locale)).contests.ranking;
  return (
    <BoardPage
      // The record shell above renders the contest's name, its trail and its tabs.
      ownsHeader={false}
      sections={[
        {
          key: 'standings',
          // Why a section and not a list: the board is read-only — no filter, no per-row action and
          // no total of its own to fill a list's slots with — and the contest's own values are
          // already the shell's, so a detail would only repeat them. What the reader gets is one
          // table whose empty meaning ("no submissions yet") the table states itself.
          title: copy.title,
          description: copy.description,
          rows: <ContestRankingTab contestId={contestId} />,
        },
      ]}
    />
  );
}
