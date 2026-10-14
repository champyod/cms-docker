'use client';

import { useState } from 'react';

import {
  clearLoginActivity,
  queueUnban,
  unlockLoginLockout,
  type BannedAddressView,
  type LoginActivityResult,
} from '@/app/actions/securityBlocks';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Input } from '@/components/core/Input';
import { ReasonDialog } from '@/components/core/ReasonDialog';
import { CaptchaStatusCard } from '@/components/security/CaptchaStatusCard';
import { ExemptionsPanel } from '@/components/security/ExemptionsPanel';
import { LoginActivityCard } from '@/components/security/LoginActivityCard';
import { useReasonPrompt } from '@/hooks/useReasonPrompt';
import type { CaptchaStatus } from '@/lib/captcha-status';
import type { Dictionary } from '@/lib/dictionary';
import type { SecurityBlock } from '@/lib/security/block-ledger';

interface BlocksPanelProps {
  readonly banned: BannedAddressView;
  readonly lockouts: readonly SecurityBlock[];
  readonly exemptions: readonly SecurityBlock[];
  readonly activity: LoginActivityResult;
  readonly captcha: CaptchaStatus;
  readonly captchaCopy: Dictionary['security']['blocks'];
}

// The native select is the one control with no core wrapper, so it carries the
// same field surface the Input adapter uses rather than a bare browser default.
const SELECT_SURFACE =
  'flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

function unbanDescription(ip: string, jail: string): string {
  return `Queue an unban for ${ip} in the ${jail} jail. The host agent applies it on its next tick.`;
}

export function BlocksPanel({ banned, lockouts, exemptions, activity, captcha, captchaCopy }: BlocksPanelProps): React.JSX.Element {
  const prompt = useReasonPrompt();
  const [manualJail, setManualJail] = useState('');
  const [manualIp, setManualIp] = useState('');
  const activeJail = manualJail === '' ? (banned.jailNames[0] ?? '') : manualJail;
  const activeIp = manualIp.trim();
  const canQueueManual = activeJail !== '' && activeIp.length > 0;

  return (
    <div className="space-y-4">
      {prompt.feedback !== null && <p className="text-sm text-muted-foreground">{prompt.feedback}</p>}

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
                  onClick={() =>
                    prompt.ask({
                      title: `Unban ${ban.ip}?`,
                      description: unbanDescription(ban.ip, ban.jail),
                      submitLabel: 'Queue unban',
                      run: (reason) => queueUnban(ban.jail, ban.ip, reason),
                    })
                  }
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
              disabled={!canQueueManual}
              onClick={() =>
                prompt.ask({
                  title: `Unban ${activeIp}?`,
                  description: unbanDescription(activeIp, activeJail),
                  submitLabel: 'Queue unban',
                  run: (reason) => queueUnban(activeJail, activeIp, reason),
                })
              }
            >
              Queue unban
            </Button>
          </div>
        </div>
      </Card>

      <ExemptionsPanel exemptions={exemptions} />

      <LoginActivityCard
        activity={activity}
        onClear={(key) =>
          prompt.ask({
            title: `Clear the counter for ${key}?`,
            description: `Lift the live failure counter for ${key}. This clears it now instead of waiting for its window to lapse.`,
            submitLabel: 'Clear counter',
            run: (reason) => clearLoginActivity(key, reason),
          })
        }
      />

      <CaptchaStatusCard status={captcha} copy={captchaCopy} />

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
            {lockouts.map((lockout) => {
              const subject = lockout.subject ?? '';
              const ip = lockout.ip ?? 'local';
              return (
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
                    onClick={() =>
                      prompt.ask({
                        title: `Unlock ${subject || 'this account'}?`,
                        description: `Lift the login lockout for ${subject || 'this account'} from ${ip}. This clears the failed-attempt counter and closes the record.`,
                        submitLabel: 'Unlock',
                        run: (reason) => unlockLoginLockout(subject, ip, reason),
                      })
                    }
                  >
                    Unlock
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ReasonDialog request={prompt.request} onClose={prompt.close} onSubmit={prompt.submit} />
    </div>
  );
}
