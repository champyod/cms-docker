import { notFound } from 'next/navigation';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { getDictionary } from '@/i18n';
import { getUserHistory } from '@/lib/people-read-models';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { BoardPage } from '@/components/patterns/BoardPage';
import {
  UserHistoryAccountAccess,
  UserHistoryEmpty,
  UserHistorySection,
} from '@/components/users/UserHistoryTab';

async function authorizeUserTab(routeId: RouteId): Promise<ReadonlySet<string>> {
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

export default async function UserHistoryPage({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<React.JSX.Element> {
  const { locale, id: rawId } = await params;
  const id = parseRecordId(rawId);
  if (id === null) notFound();
  await authorizeUserTab('people.user-tabs.history');
  const dictionary = await getDictionary(locale);
  const history = await readRecordOrNotFound(() => getUserHistory(id));
  const copy = dictionary.users.history;
  return (
    <BoardPage
      // The record shell above renders the user's name, the trail and the tabs.
      ownsHeader={false}
      // Why a board and not one list: this tab carries five different record kinds - contests,
      // participations, teams, submissions and contest activity - and each has its own meaning of
      // empty. Forcing them into one row set meant one filter and one total none of them could
      // honestly fill; a board gives each its own heading and its own empty.
      sections={[
        {
          // Not a record kind but the page's own single value, so it leads and states the one
          // thing none of the five histories can: when this account last signed in.
          key: 'account-access',
          title: copy.accountAccess,
          rows: <UserHistoryAccountAccess history={history} copy={dictionary.users} missing={dictionary.common.notSet} />,
        },
        {
          key: 'contests',
          title: copy.sections.contests.title,
          rows: <UserHistorySection section="contests" history={history} copy={dictionary.users} missing={dictionary.common.notSet} />,
          empty: history.contests.length === 0
            ? <UserHistoryEmpty title={copy.sections.contests.empty} />
            : undefined,
        },
        {
          key: 'participations',
          title: copy.sections.participations.title,
          rows: <UserHistorySection section="participations" history={history} copy={dictionary.users} missing={dictionary.common.notSet} />,
          empty: history.participations.length === 0
            ? <UserHistoryEmpty title={copy.sections.participations.empty} />
            : undefined,
        },
        {
          key: 'teams',
          title: copy.sections.teams.title,
          rows: <UserHistorySection section="teams" history={history} copy={dictionary.users} missing={dictionary.common.notSet} />,
          empty: history.teams.length === 0
            ? <UserHistoryEmpty title={copy.sections.teams.empty} />
            : undefined,
        },
        {
          key: 'submissions',
          title: copy.sections.submissions.title,
          rows: <UserHistorySection section="submissions" history={history} copy={dictionary.users} missing={dictionary.common.notSet} />,
          empty: history.submissions.length === 0
            ? <UserHistoryEmpty title={copy.sections.submissions.empty} />
            : undefined,
        },
        {
          key: 'recent-activity',
          title: copy.sections.recentActivity.title,
          rows: <UserHistorySection section="recentActivity" history={history} copy={dictionary.users} missing={dictionary.common.notSet} />,
          empty: history.recentContestActivity.length === 0
            ? <UserHistoryEmpty title={copy.sections.recentActivity.empty} />
            : undefined,
        },
      ]}
    />
  );
}
