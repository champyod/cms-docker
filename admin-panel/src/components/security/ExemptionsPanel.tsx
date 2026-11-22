'use client';

import { useState } from 'react';

import { grantLoginExemption, revokeLoginExemption } from '@/app/actions/securityExemptions';
import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';
import { ReasonDialog } from '@/components/core/ReasonDialog';
import { useReasonPrompt } from '@/hooks/useReasonPrompt';
import type { SecurityBlock } from '@/lib/security/block-ledger';
import { EXEMPTION_SCOPES, type ExemptionScope } from '@/lib/security/exemption-scopes';

// The native select is the one control with no core wrapper, so it carries the
// same field surface the Input adapter uses rather than a bare browser default.
const SELECT_SURFACE =
  'flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-2';

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

/**
 * The standing exemptions, and the form that grants one.
 *
 * WHY the grant form stays even with no rows: an operator arrives here to create the first
 * exemption, so the form cannot be a child of the list. The board section owns the frame and the
 * meaning of empty; this renders the control and the rows.
 */
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
    <div className="space-y-3">
      {prompt.feedback !== null && <p className="text-sm text-muted-foreground">{prompt.feedback}</p>}

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

      {exemptions.length > 0 && (
        <ul className="space-y-2">
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
    </div>
  );
}
