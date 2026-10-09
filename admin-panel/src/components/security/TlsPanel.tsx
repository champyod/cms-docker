'use client';

import { useState, useTransition } from 'react';

import { requestCertificateRenewal, type TlsState } from '@/app/actions/securityTls';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Input } from '@/components/core/Input';

interface TlsPanelProps {
  readonly state: TlsState;
}

export function TlsPanel({ state }: TlsPanelProps): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isBlocked = pending || reason.trim().length === 0;

  function handleRenew(): void {
    startTransition(async () => {
      const result = await requestCertificateRenewal(reason);
      setFeedback(result.success ? (result.message ?? 'Done') : (result.error ?? 'Failed'));
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-white/60">TLS proxy</dt>
            <dd className="font-mono text-sm">{state.proxyStatus ?? 'not running'}</dd>
          </div>
          <div>
            <dt className="text-sm text-white/60">Certbot</dt>
            <dd className="font-mono text-sm">{state.certbotStatus ?? 'not running'}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Certificate lineages</h2>
        {state.lineages.length === 0 ? (
          <p className="text-sm text-white/60">No readable lineage under config/letsencrypt/live.</p>
        ) : (
          <ul className="space-y-2">
            {state.lineages.map((lineage) => (
              <li key={lineage.lineage} className="rounded-xl border border-white/10 p-3">
                <p className="font-mono text-sm">{lineage.lineage}</p>
                <p className="text-xs text-white/70">{lineage.subject}</p>
                <p className={lineage.expiresSoon ? 'mt-1 text-sm text-amber-300' : 'mt-1 text-sm text-white/70'}>
                  expires {lineage.validTo} ({lineage.daysRemaining} days)
                </p>
              </li>
            ))}
          </ul>
        )}
        {state.unreadableLineages.length > 0 && (
          <p className="mt-3 text-sm text-amber-300">Unreadable: {state.unreadableLineages.join(', ')}</p>
        )}
      </Card>

      <Card>
        <Input label="Reason (required)" value={reason} onChange={(event) => setReason(event.target.value)} />
        <div className="mt-4">
          <Button loading={pending} disabled={isBlocked} onClick={handleRenew}>
            Queue certificate renewal
          </Button>
        </div>
        {feedback !== null && <p className="mt-3 text-sm text-white/70">{feedback}</p>}
        <p className="mt-3 text-xs text-white/50">
          Renewal runs on the host through scripts/__domain.sh, on the security agent&apos;s next tick.
        </p>
      </Card>
    </div>
  );
}
