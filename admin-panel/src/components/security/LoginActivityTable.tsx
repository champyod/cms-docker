'use client';

import { Fragment, useState } from 'react';

import { clearLoginActivity, readCounterAttempts } from '@/app/actions/securityBlocks';
import { Button } from '@/components/core/Button';
import { InlineAlert } from '@/components/core/InlineAlert';
import { ReasonDialog } from '@/components/core/ReasonDialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/core/Table';
import { useReasonPrompt } from '@/hooks/useReasonPrompt';
import type { LoginAttempt } from '@/lib/login-attempts';
import type { LoginActivity } from '@/lib/security/login-activity';

interface LoginActivityTableProps {
  readonly rows: readonly LoginActivity[];
  readonly labels: Readonly<Record<string, string>>;
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
 * The live failure counters a wrong password leaves behind.
 *
 * WHY it sits beside the lockout record: the record only appears once the count crosses the ban
 * threshold, while the counter is what a sub-threshold attempt — and the captcha that follows it —
 * actually is. Each row expands to the attempts that counter counted, read on demand so the page
 * never carries every list at once.
 *
 * WHY the clear lives here: it is the one write the rows offer, and it needs a reason, so the
 * prompt belongs to the table that renders the button rather than to the page above it.
 */
export function LoginActivityTable({ rows, labels }: LoginActivityTableProps): React.JSX.Element {
  const prompt = useReasonPrompt();
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
    <div className="space-y-3">
      {prompt.feedback !== null && <p className="text-sm text-muted-foreground">{prompt.feedback}</p>}
      {detailError !== null && (
        <InlineAlert tone="destructive" density="compact" title="The attempts behind this counter could not be read">
          {detailError}
        </InlineAlert>
      )}
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
          {rows.map((row) => (
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
                    <Button size="sm" variant="secondary" onClick={() => void toggle(row.key)}>
                      {openKey === row.key ? 'Hide' : 'Attempts'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        prompt.ask({
                          title: `Clear the counter for ${row.key}?`,
                          description: `Lift the live failure counter for ${row.key}. This clears it now instead of waiting for its window to lapse.`,
                          submitLabel: 'Clear counter',
                          run: (reason) => clearLoginActivity(row.key, reason),
                        })
                      }
                    >
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
      <ReasonDialog request={prompt.request} onClose={prompt.close} onSubmit={prompt.submit} />
    </div>
  );
}
