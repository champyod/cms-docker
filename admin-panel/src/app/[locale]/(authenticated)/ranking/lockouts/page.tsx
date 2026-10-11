import { clearRankingLockout, getRankingLockouts } from '@/app/actions/rankingLockouts';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { InlineAlert } from '@/components/core/InlineAlert';
import { Input } from '@/components/core/Input';
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
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import type { RankingLockout } from '@/lib/ranking-lockouts';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

const LOCKOUT_SUBJECT_HEADER = 'Subject';
const NO_LOCKOUTS_MESSAGE = 'No console lockouts are active.';

type LockoutCopy = Dictionary['ranking']['lockouts'];

interface LockoutRowProps {
  readonly lockout: RankingLockout;
  readonly canClear: boolean;
  readonly reasonPlaceholder: string;
  readonly clearLabel: string;
}

function LockoutRow({
  lockout,
  canClear,
  reasonPlaceholder,
  clearLabel,
}: LockoutRowProps): React.JSX.Element {
  return (
    <TableRow>
      <TableCell>{lockout.subject}</TableCell>
      <TableCell className="text-muted-foreground">{lockout.count}</TableCell>
      <TableCell className="text-muted-foreground">{lockout.retryAfterSeconds}s</TableCell>
      {canClear ? (
        <TableCell className="text-right">
          <form action={clearRankingLockout} className="flex items-center justify-end gap-2">
            <input type="hidden" name="key" value={lockout.key} />
            <Input name="reason" required placeholder={reasonPlaceholder} className="w-40" />
            <Button type="submit" variant="negative" size="sm">
              {clearLabel}
            </Button>
          </form>
        </TableCell>
      ) : null}
    </TableRow>
  );
}

interface LockoutListProps {
  readonly lockouts: readonly RankingLockout[];
  readonly canClear: boolean;
  readonly copy: LockoutCopy;
  readonly reasonPlaceholder: string;
}

function LockoutList({ lockouts, canClear, copy, reasonPlaceholder }: LockoutListProps): React.JSX.Element {
  if (lockouts.length === 0) {
    return <EmptyState title={NO_LOCKOUTS_MESSAGE} />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{LOCKOUT_SUBJECT_HEADER}</TableHead>
          <TableHead>{copy.failures}</TableHead>
          <TableHead>{copy.remaining}</TableHead>
          {canClear ? <TableHead className="text-right">{copy.clear}</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {lockouts.map((lockout) => (
          <LockoutRow
            key={lockout.key}
            lockout={lockout}
            canClear={canClear}
            reasonPlaceholder={reasonPlaceholder}
            clearLabel={copy.clear}
          />
        ))}
      </TableBody>
    </Table>
  );
}

export default async function RankingLockoutsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const [{ locale }, effective] = await Promise.all([
    params,
    authorizeRoutePage('ranking.lockouts'),
  ]);
  const copy = (await getDictionary(locale)).ranking;
  // The read key guards the call too: the action enforces it and an unguarded call throws.
  const canSeeLockouts = effective.has('lockout:read');
  const lockoutState = canSeeLockouts ? await getRankingLockouts() : null;
  const canClearLockouts = effective.has('lockout:unlock');
  return (
    <Stack gap={6}>
      {lockoutState === null ? null : (
        <Card className="space-y-4">
          <Text as="h2" variant="h3">
            {copy.lockouts.title}
          </Text>
          {lockoutState.ok ? (
            <LockoutList
              lockouts={lockoutState.lockouts}
              canClear={canClearLockouts}
              copy={copy.lockouts}
              reasonPlaceholder={copy.overrides.reason}
            />
          ) : (
            <InlineAlert tone="warning">{lockoutState.error}</InlineAlert>
          )}
        </Card>
      )}
    </Stack>
  );
}
