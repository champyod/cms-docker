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
import type { RankingLockoutCounters } from '@/app/actions/rankingLockouts';
import type { Dictionary } from '@/lib/dictionary';
import type { LoginLockout } from '@/lib/login-lockouts';

type LockoutCopy = Dictionary['ranking']['lockouts'];

interface LockoutRowProps {
  readonly lockout: LoginLockout;
  readonly canClear: boolean;
  readonly copy: LockoutCopy;
  readonly clearAction: (formData: FormData) => Promise<void>;
}

function LockoutRow({ lockout, canClear, copy, clearAction }: LockoutRowProps): React.JSX.Element {
  return (
    <TableRow>
      <TableCell>{copy.surfaces[lockout.surface]}</TableCell>
      <TableCell>{lockout.subject}</TableCell>
      <TableCell className="text-muted-foreground">{lockout.count}</TableCell>
      <TableCell className="text-muted-foreground">{lockout.retryAfterSeconds}s</TableCell>
      {canClear ? (
        <TableCell className="text-right">
          <form action={clearAction} className="flex items-center justify-end gap-2">
            <input type="hidden" name="key" value={lockout.key} />
            <Input name="reason" required placeholder={copy.reason} className="w-40" />
            <Button type="submit" variant="negative" size="sm">
              {copy.clear}
            </Button>
          </form>
        </TableCell>
      ) : null}
    </TableRow>
  );
}

interface LockoutTableProps {
  readonly lockouts: readonly LoginLockout[];
  readonly canClear: boolean;
  readonly copy: LockoutCopy;
  readonly clearAction: (formData: FormData) => Promise<void>;
}

function LockoutTable({ lockouts, canClear, copy, clearAction }: LockoutTableProps): React.JSX.Element {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{copy.surface}</TableHead>
          <TableHead>{copy.subject}</TableHead>
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
            copy={copy}
            clearAction={clearAction}
          />
        ))}
      </TableBody>
    </Table>
  );
}

interface LockoutCountersCardProps {
  readonly counters: RankingLockoutCounters;
  readonly canClear: boolean;
  readonly copy: LockoutCopy;
  readonly clearAction: (formData: FormData) => Promise<void>;
}

export function LockoutCountersCard({
  counters,
  canClear,
  copy,
  clearAction,
}: LockoutCountersCardProps): React.JSX.Element {
  if (!counters.ok) {
    return (
      <Card>
        <InlineAlert tone="warning" announce="polite">
          {counters.error}
        </InlineAlert>
      </Card>
    );
  }
  return (
    <Card>
      <Stack gap={4}>
        <Text as="h2" variant="h3">
          {copy.title}
        </Text>
        {counters.lockouts.length === 0 ? (
          <EmptyState title={copy.countersEmpty} />
        ) : (
          <LockoutTable lockouts={counters.lockouts} canClear={canClear} copy={copy} clearAction={clearAction} />
        )}
      </Stack>
    </Card>
  );
}
