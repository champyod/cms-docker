'use client';

import type { LoginActivityResult } from '@/app/actions/securityBlocks';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/core/Table';

interface LoginActivityCardProps {
  readonly activity: LoginActivityResult;
  readonly onClear: (key: string) => void;
}

function stamp(value: Date | null): string {
  return value === null ? '—' : value.toISOString();
}

/**
 * The live failure counters a wrong password leaves behind. An operator needs
 * this beside the lockout record: the record only appears once the count crosses
 * the ban threshold, while the counter is what a sub-threshold attempt — and the
 * captcha that follows it — actually is.
 */
export function LoginActivityCard({ activity, onClear }: LoginActivityCardProps): React.JSX.Element {
  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">Login activity</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Live failure counters from the shared store: every failed sign-in, the account and address it
        came from, when it last failed, and when that account last signed in. A counter clears whole
        when its window lapses; clearing lifts it now.
      </p>
      {!activity.ok ? (
        <p className="text-sm text-amber-300">{activity.error}</p>
      ) : activity.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No failed sign-in is being counted.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Surface</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Failures</TableHead>
              <TableHead>Last failed</TableHead>
              <TableHead>Last success</TableHead>
              <TableHead>Window left</TableHead>
              <TableHead className="text-right">Clear</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activity.rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>{row.surface}</TableCell>
                <TableCell className="font-mono">{row.username ?? '—'}</TableCell>
                <TableCell className="font-mono">{row.ip}</TableCell>
                <TableCell>{row.failures}</TableCell>
                <TableCell className="text-muted-foreground">{stamp(row.lastFailedAt)}</TableCell>
                <TableCell className="text-muted-foreground">{stamp(row.lastSuccessAt)}</TableCell>
                <TableCell className="text-muted-foreground">{row.windowSeconds}s</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onClear(row.key)}
                  >
                    Clear
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
