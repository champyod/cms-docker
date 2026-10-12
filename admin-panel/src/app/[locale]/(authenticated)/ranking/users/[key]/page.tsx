import { notFound } from 'next/navigation';

import {
  getRankingOverrideOptions,
  getRankingUserDetail,
  type RankingTask,
  type RankingUserEntry,
} from '@/app/actions/ranking';
import {
  endRankingOverride,
  getRankingOverrides,
  type RankingOverride,
} from '@/app/actions/rankingOverrides';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { Input } from '@/components/core/Input';
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
import { RankingOverrideForm, type RankingOverrideCopy } from '@/components/ranking/RankingOverrideForm';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

type UsersCopy = Dictionary['ranking']['users'];

const EMPTY_VALUE = '—';
const MUTED = 'text-muted-foreground';
const TOTAL_SCORE_PRECISION = 0;

const ACTION_LABEL_KEYS: Readonly<Record<string, keyof RankingOverrideCopy>> = {
  hide: 'actionHide',
  guest: 'actionGuest',
  pin: 'actionPin',
  rename: 'actionRename',
  score: 'actionScore',
};

function actionLabel(copy: RankingOverrideCopy, action: string): string {
  const key = ACTION_LABEL_KEYS[action];
  return key === undefined ? action : copy[key];
}

function taskScore(entry: RankingUserEntry, task: RankingTask): string {
  const value = entry.taskScores[task.id];
  return value === undefined ? EMPTY_VALUE : value.toFixed(task.scorePrecision);
}

function activeOverrides(
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
    <div>
      <Text as="dt" variant="label" color={MUTED}>
        {term}
      </Text>
      <Text as="dd" variant="small" className="text-foreground/80">
        {value}
      </Text>
    </div>
  );
}

interface IdentityProps {
  readonly entry: RankingUserEntry;
  readonly copy: UsersCopy;
}

function Identity({ entry, copy }: IdentityProps): React.JSX.Element {
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

interface TaskScoresProps {
  readonly entry: RankingUserEntry;
  readonly tasks: readonly RankingTask[];
  readonly copy: UsersCopy;
}

function TaskScores({ entry, tasks, copy }: TaskScoresProps): React.JSX.Element {
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
                <TableCell>
                  <span title={task.title}>{task.name}</span>
                </TableCell>
                <TableCell className={MUTED}>{taskScore(entry, task)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

interface OverrideRowProps {
  readonly override: RankingOverride;
  readonly copy: RankingOverrideCopy;
}

function OverrideRow({ override, copy }: OverrideRowProps): React.JSX.Element {
  const value = override.value === '' ? EMPTY_VALUE : override.value;
  return (
    <TableRow>
      <TableCell>{actionLabel(copy, override.action)}</TableCell>
      <TableCell className={MUTED}>{value}</TableCell>
      <TableCell className={MUTED}>{override.reason}</TableCell>
      <TableCell className="text-right">
        <form action={endRankingOverride} className="flex items-center justify-end gap-2">
          <input type="hidden" name="id" value={override.id} />
          <Input name="reason" required placeholder={copy.reason} className="w-40" />
          <Button type="submit" variant="negative" size="sm">
            {copy.end}
          </Button>
        </form>
      </TableCell>
    </TableRow>
  );
}

interface ActiveOverridesProps {
  readonly overrides: readonly RankingOverride[];
  readonly copy: RankingOverrideCopy;
  readonly canOverride: boolean;
  readonly emptyLabel: string;
}

function ActiveOverrides({
  overrides,
  copy,
  canOverride,
  emptyLabel,
}: ActiveOverridesProps): React.JSX.Element {
  if (overrides.length === 0) {
    return <EmptyState title={emptyLabel} />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{copy.action}</TableHead>
          <TableHead>{copy.value}</TableHead>
          <TableHead>{copy.reason}</TableHead>
          {canOverride ? <TableHead className="text-right">{copy.end}</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {overrides.map((override) => (
          <OverrideRow key={override.id} override={override} copy={copy} />
        ))}
      </TableBody>
    </Table>
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
  const overrides = activeOverrides(await getRankingOverrides(), detail.entry);
  return (
    <Stack gap={6}>
      <Identity entry={detail.entry} copy={copy.users} />
      <TaskScores entry={detail.entry} tasks={detail.tasks} copy={copy.users} />
      <Card className="space-y-4">
        <Text as="h2" variant="h3">
          {copy.users.activeOverrides}
        </Text>
        {canOverride && options !== null ? (
          <RankingOverrideForm
            copy={copy.overrides}
            contests={options.contests}
            userKeys={options.userKeys}
            teamKeys={options.teamKeys}
            contestId={String(detail.entry.contestId)}
            targetKind="user"
            targetKey={detail.entry.username}
          />
        ) : null}
        <ActiveOverrides
          overrides={overrides}
          copy={copy.overrides}
          canOverride={canOverride}
          emptyLabel={copy.users.overridesEmpty}
        />
      </Card>
    </Stack>
  );
}
