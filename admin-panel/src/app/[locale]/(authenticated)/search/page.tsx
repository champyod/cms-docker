import Link from 'next/link';
import { notFound } from 'next/navigation';

import { searchAll } from '@/app/actions/search';
import { Text } from '@/components/core/Typography';
import { BoardPage, type BoardSection } from '@/components/patterns/BoardPage';
import { SearchResultCard } from '@/components/search/SearchComponents';
import { getDictionary } from '@/i18n';
import { buildRoute } from '@/lib/navigation/routes';
import { checkPermission } from '@/lib/permissions';

type SearchResults = Awaited<ReturnType<typeof searchAll>>;

const NO_RESULTS: SearchResults = { users: [], tasks: [], contests: [], admins: [] };

/** One kind's matches, in the two-column grid every kind uses so the four sections read alike. */
function ResultGrid({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>;
}

/**
 * The results of one query, one section per record kind.
 *
 * WHY a board: the search answers with four kinds that share no row shape and no meaning of empty -
 * a user, a task, a contest and an admin - and the reader's first question is which kind answered
 * at all. A list would have had to invent one row set, one filter and one total across the four;
 * the board lets each kind keep its own rows and say for itself that it matched nothing.
 *
 * WHY the query is read on the server: the results are the answer to an address, so the page renders
 * them from the request instead of refetching after the browser has already drawn an empty page. The
 * same address now produces the same HTML, and the reader can send it to somebody.
 */
export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const { q } = await searchParams;
  const query = (q ?? '').trim();

  // Why: return 404 for forbidden access so existence is indistinguishable from missing page
  if (!(await checkPermission('all:all', false))) {
    notFound();
  }

  const [dict, results] = await Promise.all([
    getDictionary(locale),
    query.length > 0 ? searchAll(query) : Promise.resolve(NO_RESULTS),
  ]);
  const copy = dict.search;
  const fill = (template: string, value: string): string => template.replace('{query}', value);
  const nothingMatched =
    results.users.length === 0 &&
    results.tasks.length === 0 &&
    results.contests.length === 0 &&
    results.admins.length === 0;

  const sections: readonly BoardSection[] = [
    {
      key: 'users',
      title: copy.kinds.users,
      count: results.users.length,
      rows: (
        <ResultGrid>
          {results.users.map((user) => (
            <Link key={user.id} href={buildRoute(locale, 'people.user-tabs.profile', { id: user.id })}>
              <SearchResultCard title={user.username} subtitle={`${user.first_name} ${user.last_name}`} />
            </Link>
          ))}
        </ResultGrid>
      ),
      empty: <Text variant="muted">{copy.empty.users}</Text>,
    },
    {
      key: 'tasks',
      title: copy.kinds.tasks,
      count: results.tasks.length,
      rows: (
        <ResultGrid>
          {results.tasks.map((task) => (
            <Link key={task.id} href={buildRoute(locale, 'tasks.record', { id: task.id })}>
              <SearchResultCard title={task.name} subtitle={task.title} />
            </Link>
          ))}
        </ResultGrid>
      ),
      empty: <Text variant="muted">{copy.empty.tasks}</Text>,
    },
    {
      key: 'contests',
      title: copy.kinds.contests,
      count: results.contests.length,
      rows: (
        <ResultGrid>
          {results.contests.map((contest) => (
            <Link key={contest.id} href={buildRoute(locale, 'contests.record', { id: contest.id })}>
              <SearchResultCard title={contest.name} subtitle={contest.description} />
            </Link>
          ))}
        </ResultGrid>
      ),
      empty: <Text variant="muted">{copy.empty.contests}</Text>,
    },
    {
      key: 'admins',
      title: copy.kinds.admins,
      count: results.admins.length,
      rows: (
        <ResultGrid>
          {results.admins.map((admin) => (
            // Why no link: an administrator has no page of its own, so a card that looks pressable
            // would promise a destination the panel does not have.
            <SearchResultCard key={admin.id} title={admin.username} subtitle={admin.name} className="cursor-default" />
          ))}
        </ResultGrid>
      ),
      empty: <Text variant="muted">{copy.empty.admins}</Text>,
    },
  ];

  return (
    <BoardPage
      title={dict.navigation.system.search.label}
      description={query.length > 0 ? fill(copy.resultsFor, query) : undefined}
      state={
        query.length === 0 ? (
          <Text variant="muted">{copy.prompt}</Text>
        ) : nothingMatched ? (
          <Text variant="muted">{copy.noResults}</Text>
        ) : undefined
      }
      sections={sections}
    />
  );
}
