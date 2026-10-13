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
import type { Dictionary } from '@/lib/dictionary';
import type { SecurityBlock } from '@/lib/security/block-ledger';
import { formatListMomentInZone } from '@/lib/timezone';

type LockoutCopy = Dictionary['ranking']['lockouts'];

const MISSING = '—';

function moment(value: Date | null): string {
  return value === null ? MISSING : formatListMomentInZone(value.toISOString());
}

interface LockoutHistoryCardProps {
  readonly history: readonly SecurityBlock[];
  readonly copy: LockoutCopy;
}

export function LockoutHistoryCard({ history, copy }: LockoutHistoryCardProps): React.JSX.Element {
  return (
    <Card>
      <Stack gap={4}>
        <Text as="h2" variant="h3">
          {copy.historyTitle}
        </Text>
        <Text variant="muted">{copy.historyHint}</Text>
        {history.length === 0 ? (
          <EmptyState title={copy.historyEmpty} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.subject}</TableHead>
                <TableHead>{copy.address}</TableHead>
                <TableHead>{copy.refusedAt}</TableHead>
                <TableHead>{copy.expiresAt}</TableHead>
                <TableHead>{copy.state}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((block) => (
                <TableRow key={block.id}>
                  <TableCell>{block.subject ?? MISSING}</TableCell>
                  <TableCell className="text-muted-foreground">{block.ip ?? MISSING}</TableCell>
                  <TableCell className="text-muted-foreground">{moment(block.startedAt)}</TableCell>
                  <TableCell className="text-muted-foreground">{moment(block.expiresAt)}</TableCell>
                  <TableCell>{block.active ? copy.stateActive : copy.stateEnded}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Stack>
    </Card>
  );
}
