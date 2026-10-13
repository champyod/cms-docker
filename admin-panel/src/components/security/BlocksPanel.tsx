'use client';

import { useState, useTransition } from 'react';

import {
  queueUnban,
  unlockLoginLockout,
  type BannedAddressView,
} from '@/app/actions/securityBlocks';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Input } from '@/components/core/Input';
import type { SecurityBlock } from '@/lib/security/block-ledger';

interface BlocksPanelProps {
  readonly banned: BannedAddressView;
  readonly lockouts: readonly SecurityBlock[];
}

// The native select is the one control with no core wrapper, so it carries the
// same field surface the Input adapter uses rather than a bare browser default.
const SELECT_SURFACE =
  'flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

export function BlocksPanel({ banned, lockouts }: BlocksPanelProps): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [manualJail, setManualJail] = useState('');
  const [manualIp, setManualIp] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isBlocked = pending || reason.trim().length === 0;
  const activeJail = manualJail === '' ? (banned.jailNames[0] ?? '') : manualJail;
  const canQueueManual = !isBlocked && activeJail !== '' && manualIp.trim().length > 0;

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
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-semibold">Banned addresses</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Host-level IP bans applied by fail2ban at the proxy. These are a different layer
          from the login lockouts below, which the web servers count per account and address.
        </p>
        {!banned.agentReported && (
          <p className="mb-3 text-sm text-amber-300">
            The host security agent has not reported state yet, so no live ban is listed. An
            unban queued below is applied when the agent next runs.
          </p>
        )}
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

        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <p className="text-sm font-medium">Queue an unban by address</p>
          <div className="flex flex-wrap items-end gap-2">
            {banned.jailNames.length > 0 && (
              <label className="space-y-1.5">
                <span className="ml-1 block text-sm font-medium text-foreground">Jail</span>
                <select
                  className={SELECT_SURFACE}
                  value={activeJail}
                  onChange={(event) => setManualJail(event.target.value)}
                >
                  {banned.jailNames.map((jail) => (
                    <option key={jail} value={jail}>{jail}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="w-56">
              <Input label="IP address" value={manualIp} onChange={(event) => setManualIp(event.target.value)} placeholder="10.0.0.5" />
            </div>
            <Button
              size="sm"
              variant="secondary"
              loading={pending}
              disabled={!canQueueManual}
              onClick={() => run(() => queueUnban(activeJail, manualIp.trim(), reason))}
            >
              Queue unban
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-semibold">Login lockouts</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          The captcha hard limit: after repeated failed passwords the contest and admin web
          servers refuse the account and address for the lockout window. Lifting one clears
          the counter and closes the record.
        </p>
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
    </div>
  );
}
