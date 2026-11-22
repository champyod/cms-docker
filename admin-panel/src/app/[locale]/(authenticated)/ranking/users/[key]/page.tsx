import { notFound } from 'next/navigation';

import {
  getRankingOverrideOptions,
  getRankingUserDetail,
  type RankingTask,
  type RankingUserEntry,
} from '@/app/actions/ranking';
import { getRankingOverrides, type RankingOverride } from '@/app/actions/rankingOverrides';
import { SectionCard } from '@/components/core/SectionCard';
import { EmptyState } from '@/components/core/EmptyState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/core/Table';
import { DetailPage } from '@/components/patterns/DetailPage';
import { RankingOverrideList } from '@/components/ranking/RankingOverrideList';
import { RankingOverrideSurface } from '@/components/ranking/RankingOverrideSurface';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

type UsersCopy = Dictionary['ranking']['users'];
type RankingCopy = Dictionary['ranking'];
type OverrideOptions = Awaited<ReturnType<typeof getRankingOverrideOptions>>;

const EMPTY_VALUE = '—';
const MUTED = 'text-muted-foreground';
const TOTAL_SCORE_PRECISION = 0;

function taskScore(entry: RankingUserEntry, task: RankingTask): string {
  const value = entry.taskScores[task.id];
  return value === undefined ? EMPTY_VALUE : value.toFixed(task.scorePrecision);
}

/**
 * WHY the contest predicate is still here: the query is already scoped, but this helper also
 * filters by target kind and key, and keeping the contest predicate makes it correct on its own
 * rather than only when its caller has already narrowed the list.
 */
function userOverrides(
  overrides: readonly RankingOverride[],
  entry: RankingUserEntry,
): RankingOverride[] {
  return overrides.filter(
    (override) =>
      override.targetKind === 'user' &&
      override.targetKey === entry.username &&
      override.contestId === entry.contestId,
  );
}

function TaskScores({
  entry,
  tasks,
  copy,
}: {
  readonly entry: RankingUserEntry;
  readonly tasks: readonly RankingTask[];
  readonly copy: UsersCopy;
}): React.JSX.Element {
  return (
    <SectionCard title={copy.taskScores}>
      {tasks.length === 0 ? (
        <EmptyState title={copy.scoresEmpty} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.task}</TableHead>
              <TableHead>{copy.score}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell className="max-w-[200px]">
                  <span className="truncate block" title={task.title}>{task.name}</span>
                </TableCell>
                <TableCell className={`${MUTED} w-24 font-mono`}>{taskScore(entry, task)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}

interface OverrideCardProps {
  readonly copy: RankingCopy;
  readonly entry: RankingUserEntry;
  readonly options: OverrideOptions | null;
  readonly overrides: readonly RankingOverride[];
  readonly canOverride: boolean;
}

/** The same toolbar and diff as the list page, narrowed to the one user this page is about. */
function OverrideCard({ copy, entry, options, overrides, canOverride }: OverrideCardProps): React.JSX.Element {
  return (
    <SectionCard title={copy.users.activeOverrides}>
      {canOverride && options !== null ? (
        <RankingOverrideSurface
          copy={copy.overrides}
          contestId={entry.contestId}
          targetKind="user"
          targetKey={entry.username}
          userKeys={options.userKeys}
          teamKeys={options.teamKeys}
          contestKeys={options.contestKeys}
          taskKeys={options.taskKeys}
        />
      ) : null}
      <RankingOverrideList copy={copy.overrides} rows={overrides} orphanContestIds={[]} canOverride={canOverride} />
    </SectionCard>
  );
}

/**
 * One participant's row, opened.
 *
 * WHY a detail and not a list: the page is about a single record — a participation in a contest —
 * and its six values are read as a fact strip rather than as the first table on the page. The
 * scores and the overrides are sections belonging to that record, not further rows of one set.
 */
export default async function RankingUserDetailPage({
  params,
}: {
  params: Promise<{ locale: string; key: string }>;
}): Promise<React.JSX.Element> {
  const [{ locale, key }, effective] = await Promise.all([
    params,
    authorizeRoutePage('ranking.users'),
  ]);
  const copy = (await getDictionary(locale)).ranking;
  const detail = await getRankingUserDetail(key);
  if (detail === null) notFound();
  const canOverride = effective.has('ranking:override');
  const options = canOverride ? await getRankingOverrideOptions() : null;
  const overrides = userOverrides(await getRankingOverrides(detail.entry.contestId), detail.entry);
  return (
    <DetailPage
      // The module shell above renders the title, the description and the trail.
      ownsHeader={false}
      title={detail.entry.displayName}
      facts={[
        { term: copy.users.name, value: detail.entry.displayName },
        { term: copy.users.username, value: detail.entry.username },
        { term: copy.users.team, value: detail.entry.teamName ?? EMPTY_VALUE },
        { term: copy.users.total, value: detail.entry.totalScore.toFixed(TOTAL_SCORE_PRECISION) },
        { term: copy.users.rank, value: String(detail.entry.rank) },
        {
          term: copy.users.hidden,
          value: detail.entry.hidden ? copy.users.hiddenYes : copy.users.hiddenNo,
        },
      ]}
    >
      <div className="space-y-4">
        <TaskScores entry={detail.entry} tasks={detail.tasks} copy={copy.users} />
        <OverrideCard
          copy={copy}
          entry={detail.entry}
          options={options}
          overrides={overrides}
          canOverride={canOverride}
        />
      </div>
    </DetailPage>
  );
}
