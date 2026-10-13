import { getRankingOverrideOptions, getRankingUsers, type RankingUserEntry } from '@/app/actions/ranking';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { Stack } from '@/components/core/Layout';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/core/Table';
import { Text } from '@/components/core/Typography';
import { RankingOverrideForm } from '@/components/ranking/RankingOverrideForm';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { buildRoute } from '@/lib/navigation/routes';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

type UsersCopy = Dictionary['ranking']['users'];

const EMPTY_VALUE = '—';
const ROW_LINK = 'text-foreground underline-offset-4 hover:underline';
const MUTED = 'text-muted-foreground';
const HIDDEN_FLAG = 'text-warning';
const TOTAL_SCORE_PRECISION = 0;

function userHref(locale: string, username: string): string {
  return `${buildRoute(locale, 'ranking.users')}/${encodeURIComponent(username)}`;
}

function score(value: number): string {
  return value.toFixed(TOTAL_SCORE_PRECISION);
}

interface UserRowProps {
  readonly locale: string;
  readonly entry: RankingUserEntry;
  readonly copy: UsersCopy;
}

function UserRow({ locale, entry, copy }: UserRowProps): React.JSX.Element {
  return (
    <TableRow className="relative">
      <TableCell>
        {/* Stretched link: the hint invites a row click, and a server row cannot take
            onClick, so the name link's overlay makes the whole row the target. */}
        <a
          href={userHref(locale, entry.username)}
          className={`${ROW_LINK} after:absolute after:inset-0 after:content-['']`}
        >
          {entry.displayName}
        </a>
        <span className={`ml-2 text-xs ${MUTED}`}>{entry.username}</span>
      </TableCell>
      <TableCell className={MUTED}>{entry.teamName ?? EMPTY_VALUE}</TableCell>
      <TableCell className={MUTED}>{score(entry.totalScore)}</TableCell>
      <TableCell className={MUTED}>{entry.rank}</TableCell>
      <TableCell>
        <span className={entry.hidden ? HIDDEN_FLAG : MUTED}>
          {entry.hidden ? copy.hiddenYes : copy.hiddenNo}
        </span>
      </TableCell>
    </TableRow>
  );
}

interface UserListProps {
  readonly locale: string;
  readonly users: readonly RankingUserEntry[];
  readonly copy: UsersCopy;
}

function UserList({ locale, users, copy }: UserListProps): React.JSX.Element {
  if (users.length === 0) {
    return <EmptyState title={copy.empty} />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{copy.name}</TableHead>
          <TableHead>{copy.team}</TableHead>
          <TableHead>{copy.total}</TableHead>
          <TableHead>{copy.rank}</TableHead>
          <TableHead>{copy.hidden}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((entry) => (
          <UserRow key={entry.participationId} locale={locale} entry={entry} copy={copy} />
        ))}
      </TableBody>
    </Table>
  );
}

// Plain server form plus the operator's read: hidden participations stay visible here.
export default async function RankingUsersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const [{ locale }, effective] = await Promise.all([
    params,
    authorizeRoutePage('ranking.users'),
  ]);
  const copy = (await getDictionary(locale)).ranking;
  const users = await getRankingUsers();
  const canOverride = effective.has('ranking:override');
  const options = canOverride ? await getRankingOverrideOptions() : null;
  return (
    <Stack gap={6}>
      <Card className="space-y-4">
        <Text as="h2" variant="h3">
          {copy.users.title}
        </Text>
        <Text variant="muted">{copy.users.hint}</Text>
        {canOverride && options !== null ? (
          <RankingOverrideForm
            copy={copy.overrides}
            contests={options.contests}
            userKeys={options.userKeys}
            teamKeys={options.teamKeys}
            contestId=""
            targetKind="user"
            targetKey=""
          />
        ) : null}
        <UserList locale={locale} users={users} copy={copy.users} />
      </Card>
    </Stack>
  );
}
