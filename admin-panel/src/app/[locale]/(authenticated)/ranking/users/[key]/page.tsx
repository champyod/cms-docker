import { notFound } from 'next/navigation';

import {
  getRankingOverrideOptions,
  getRankingUserDetail,
  type RankingTask,
  type RankingUserEntry,
} from '@/app/actions/ranking';
import { getRankingOverrides, type RankingOverride } from '@/app/actions/rankingOverrides';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { Grid, Stack } from '@/components/core/Layout';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/core/Table';
import { Text } from '@/components/core/Typography';
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

interface DetailFieldProps {
  readonly term: string;
  readonly value: string;
}

function DetailField({ term, value }: DetailFieldProps): React.JSX.Element {
  return (
    <div className="min-w-0">
      <Text as="dt" variant="label" color={MUTED}>
        {term}
      </Text>
      <Text as="dd" variant="small" className="text-foreground/80 truncate block" title={value}>
        {value}
      </Text>
    </div>
  );
}

function Identity({ entry, copy }: { readonly entry: RankingUserEntry; readonly copy: UsersCopy }): React.JSX.Element {
  return (
    <Card className="space-y-4">
      <Text as="h2" variant="h3">
        {copy.identity}
      </Text>
      <Grid as="dl" cols={2} gap={3} className="text-sm">
        <DetailField term={copy.name} value={entry.displayName} />
        <DetailField term={copy.username} value={entry.username} />
        <DetailField term={copy.team} value={entry.teamName ?? EMPTY_VALUE} />
        <DetailField term={copy.total} value={entry.totalScore.toFixed(TOTAL_SCORE_PRECISION)} />
        <DetailField term={copy.rank} value={String(entry.rank)} />
        <DetailField term={copy.hidden} value={entry.hidden ? copy.hiddenYes : copy.hiddenNo} />
      </Grid>
    </Card>
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
    <Card className="space-y-4">
      <Text as="h2" variant="h3">
        {copy.taskScores}
      </Text>
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
    </Card>
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
    <Card className="space-y-4">
      <Text as="h2" variant="h3">
        {copy.users.activeOverrides}
      </Text>
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
    </Card>
  );
}

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
    <Stack gap={6}>
      <Identity entry={detail.entry} copy={copy.users} />
      <TaskScores entry={detail.entry} tasks={detail.tasks} copy={copy.users} />
      <OverrideCard
        copy={copy}
        entry={detail.entry}
        options={options}
        overrides={overrides}
        canOverride={canOverride}
      />
    </Stack>
  );
}
