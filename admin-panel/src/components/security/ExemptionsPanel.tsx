'use client';

import { useState } from 'react';

import { grantLoginExemption, revokeLoginExemption } from '@/app/actions/securityExemptions';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Input } from '@/components/core/Input';
import { ReasonDialog } from '@/components/core/ReasonDialog';
import { useReasonPrompt } from '@/hooks/useReasonPrompt';
import type { SecurityBlock } from '@/lib/security/block-ledger';
import { EXEMPTION_SCOPES, type ExemptionScope } from '@/lib/security/exemption-scopes';

// The native select is the one control with no core wrapper, so it carries the
// same field surface the Input adapter uses rather than a bare browser default.
const SELECT_SURFACE =
  'flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

const SCOPE_LABELS: Record<ExemptionScope, string> = {
  account_address: 'Account + address',
  account: 'Account (any address)',
  address: 'Address (any account)',
};

interface ExemptionsPanelProps {
  readonly exemptions: readonly SecurityBlock[];
}

function exemptionIdentityLabel(subject: string, ip: string): string {
  return `${subject || '*'} @ ${ip || '*'}`;
}

export function ExemptionsPanel({ exemptions }: ExemptionsPanelProps): React.JSX.Element {
  const prompt = useReasonPrompt();
  const [scope, setScope] = useState<ExemptionScope>('account_address');
  const [username, setUsername] = useState('');
  const [ip, setIp] = useState('');
  const needsUsername = scope !== 'address';
  const needsIp = scope !== 'account';
  const missingInput = (needsUsername && username.trim().length === 0) || (needsIp && ip.trim().length === 0);
  const canGrant = !missingInput;

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">Permanent exemptions</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        A standing lift: the chosen account or address is never locked out or challenged until it is
        revoked. This is a login-layer exemption, separate from the host bans fail2ban applies.
      </p>
      {prompt.feedback !== null && <p className="mb-3 text-sm text-muted-foreground">{prompt.feedback}</p>}

      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1.5">
          <span className="ml-1 block text-sm font-medium text-foreground">Scope</span>
          <select
            className={SELECT_SURFACE}
            value={scope}
            onChange={(event) => setScope(event.target.value as ExemptionScope)}
          >
            {EXEMPTION_SCOPES.map((value) => (
              <option key={value} value={value}>{SCOPE_LABELS[value]}</option>
            ))}
          </select>
        </label>
        <div className="w-48">
          <Input label="Username" value={username} disabled={scope === 'address'} onChange={(event) => setUsername(event.target.value)} />
        </div>
        <div className="w-48">
          <Input label="IP address" value={ip} disabled={scope === 'account'} onChange={(event) => setIp(event.target.value)} />
        </div>
        <Button
          variant="danger"
          size="sm"
          disabled={!canGrant}
          onClick={() =>
            prompt.ask({
              title: 'Exempt this identity permanently?',
              description: `Never lock out or challenge ${exemptionIdentityLabel(username, ip)} again until revoked.`,
              submitLabel: 'Exempt permanently',
              run: (reason) => grantLoginExemption(scope, username, ip, reason),
            })
          }
        >
          Exempt permanently
        </Button>
      </div>

      {exemptions.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No permanent exemption is active.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {exemptions.map((exemption) => {
            const subject = exemption.subject ?? '';
            const exemptionIp = exemption.ip ?? '';
            return (
              <li key={exemption.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
                <span className="font-mono text-sm">
                  {exemption.subject ?? 'any account'} · {exemption.ip ?? 'any address'}
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() =>
                    prompt.ask({
                      title: 'Revoke this exemption?',
                      description: `Lockouts and challenges apply to ${exemptionIdentityLabel(subject, exemptionIp)} again.`,
                      submitLabel: 'Revoke',
                      run: (reason) => revokeLoginExemption(subject, exemptionIp, reason),
                    })
                  }
                >
                  Revoke
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <ReasonDialog request={prompt.request} onClose={prompt.close} onSubmit={prompt.submit} />
    </Card>
  );
}
