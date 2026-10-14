'use client';

import { Fragment, useState } from 'react';

import { readCounterAttempts, type LoginActivityResult } from '@/app/actions/securityBlocks';
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
import type { LoginAttempt } from '@/lib/login-attempts';

interface LoginActivityCardProps {
  readonly activity: LoginActivityResult;
  readonly labels: Readonly<Record<string, string>>;
  readonly onClear: (key: string) => void;
}

function stamp(value: Date | null): string {
  return value === null ? '—' : value.toISOString();
}

function surfaceName(labels: Readonly<Record<string, string>>, key: string): string {
  return labels[key] ?? key;
}

function attemptedAt(attempt: LoginAttempt): string {
  return new Date(attempt.at).toISOString();
}

/**
 * The live failure counters a wrong password leaves behind. An operator needs this
 * beside the lockout record: the record only appears once the count crosses the ban
 * threshold, while the counter is what a sub-threshold attempt — and the captcha that
 * follows it — actually is. Each row expands to the attempts that counter counted,
 * read on demand so the page never carries every list at once.
 */
export function LoginActivityCard({ activity, labels, onClear }: LoginActivityCardProps): React.JSX.Element {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<Readonly<Record<string, readonly LoginAttempt[]>>>({});
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle(key: string): Promise<void> {
    if (openKey === key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(key);
    if (attempts[key] !== undefined) return;
    setLoading(true);
    setDetailError(null);
    const result = await readCounterAttempts(key);
    setLoading(false);
    if (!result.ok) {
      setDetailError(result.error);
      return;
    }
    setAttempts((previous) => ({ ...previous, [key]: result.attempts }));
  }

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">Login activity</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Live failure counters from the shared store: every failed sign-in, the account and address it
        came from, when it last failed, and when that account last signed in. A counter clears whole
        when its window lapses; clearing lifts it now. Expand a row for the attempts behind it.
      </p>
      {detailError !== null && <p className="mb-3 text-sm text-amber-300">{detailError}</p>}
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
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activity.rows.map((row) => (
              <Fragment key={row.key}>
                <TableRow>
                  <TableCell>{surfaceName(labels, row.surface)}</TableCell>
                  <TableCell className="font-mono">{row.username ?? '—'}</TableCell>
                  <TableCell className="font-mono">{row.ip}</TableCell>
                  <TableCell>{row.failures}</TableCell>
                  <TableCell className="text-muted-foreground">{stamp(row.lastFailedAt)}</TableCell>
                  <TableCell className="text-muted-foreground">{stamp(row.lastSuccessAt)}</TableCell>
                  <TableCell className="text-muted-foreground">{row.windowSeconds}s</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => toggle(row.key)}>
                        {openKey === row.key ? 'Hide' : 'Attempts'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => onClear(row.key)}>
                        Clear
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {openKey === row.key && (
                  <TableRow>
                    <TableCell colSpan={8} className="bg-muted/40">
                      {loading && attempts[row.key] === undefined ? (
                        <p className="text-sm text-muted-foreground">Loading attempts…</p>
                      ) : (attempts[row.key] ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No attempt is recorded.</p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Time</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>IP</TableHead>
                              <TableHead>User-Agent</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(attempts[row.key] ?? []).map((attempt, index) => (
                              <TableRow key={`${attempt.at}-${index}`}>
                                <TableCell className="text-muted-foreground">{attemptedAt(attempt)}</TableCell>
                                <TableCell>{surfaceName(labels, attempt.surfaceKey)}</TableCell>
                                <TableCell className="font-mono">{attempt.ip}</TableCell>
                                <TableCell className="text-muted-foreground">{attempt.ua ?? '—'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
