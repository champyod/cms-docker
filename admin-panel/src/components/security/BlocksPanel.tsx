'use client';

import { useState, useTransition } from 'react';

import {
  queueUnban,
  unlockLoginLockout,
  unlockServerLoginLockout,
  type BannedAddressView,
  type ServerLockoutView,
} from '@/app/actions/securityBlocks';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Input } from '@/components/core/Input';
import type { SecurityBlock } from '@/lib/security/block-ledger';

interface BlocksPanelProps {
  readonly banned: BannedAddressView;
  readonly lockouts: readonly SecurityBlock[];
  readonly serverLockouts: ServerLockoutView;
}

export function BlocksPanel({ banned, lockouts, serverLockouts }: BlocksPanelProps): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isBlocked = pending || reason.trim().length === 0;

  function run(action: () => Promise<{ success: boolean; error?: string; message?: string }>): void {
    startTransition(async () => {
      const result = await action();
      setFeedback(result.success ? (result.message ?? 'Done') : (result.error ?? 'Failed'));
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <Input label="Reason (required for every action)" value={reason} onChange={(event) => setReason(event.target.value)} />
        {feedback !== null && <p className="mt-3 text-sm text-muted-foreground">{feedback}</p>}
        {!banned.agentReported && (
          <p className="mt-3 text-sm text-amber-300">
            The host security agent has not reported state yet, so no unban can be queued.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Banned addresses</h2>
        {banned.bans.length === 0 ? (
          <p className="text-sm text-muted-foreground">No banned address is reported.</p>
        ) : (
          <ul className="space-y-2">
            {banned.bans.map((ban) => (
              <li key={`${ban.jail}/${ban.ip}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
                <span className="font-mono text-sm">
                  {ban.ip} · {ban.jail}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending}
                  disabled={isBlocked}
                  onClick={() => run(() => queueUnban(ban.jail, ban.ip, reason))}
                >
                  Unban
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Login lockouts</h2>
        {lockouts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open lockout.</p>
        ) : (
          <ul className="space-y-2">
            {lockouts.map((lockout) => (
              <li
                key={lockout.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3"
              >
                <span className="font-mono text-sm">
                  {lockout.subject ?? 'unknown'} · {lockout.ip ?? 'local'} · until{' '}
                  {lockout.expiresAt === null ? 'unknown' : lockout.expiresAt.toISOString()}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending}
                  disabled={isBlocked}
                  onClick={() => run(() => unlockLoginLockout(lockout.subject ?? '', lockout.ip ?? 'local', reason))}
                >
                  Unlock
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Contest and admin server lockouts</h2>
        {serverLockouts.error !== null ? (
          <p className="text-sm text-amber-300">{serverLockouts.error}</p>
        ) : serverLockouts.lockouts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No lockout is recorded by the contest or admin web server.
          </p>
        ) : (
          <ul className="space-y-2">
            {serverLockouts.lockouts.map((lockout) => (
              <li
                key={lockout.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3"
              >
                <span className="font-mono text-sm">
                  {lockout.subject} · {lockout.count} failures · {lockout.retryAfterSeconds}s left
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending}
                  disabled={isBlocked}
                  onClick={() => run(() => unlockServerLoginLockout(lockout.key, reason))}
                >
                  Unlock
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
