'use client';

import { useState } from 'react';

import { queueUnban } from '@/app/actions/securityBlocks';
import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';
import { ReasonDialog } from '@/components/core/ReasonDialog';
import { Select } from '@/components/core/Select';
import { useReasonPrompt } from '@/hooks/useReasonPrompt';

interface QueueUnbanFormProps {
  readonly jailNames: readonly string[];
}

function unbanDescription(ip: string, jail: string): string {
  return `Queue an unban for ${ip} in the ${jail} jail. The host agent applies it on its next tick.`;
}

/**
 * Queueing an unban for an address the host agent has not listed yet.
 *
 * WHY it is separate from the list of live bans: a ban the panel cannot see is exactly when this
 * control is needed — the agent may not have reported yet, or the address may already be gone from
 * the ledger — so it has to survive an empty list rather than sit under one.
 */
export function QueueUnbanForm({ jailNames }: QueueUnbanFormProps): React.JSX.Element {
  const prompt = useReasonPrompt();
  const [jail, setJail] = useState('');
  const [ip, setIp] = useState('');
  const activeJail = jail === '' ? (jailNames[0] ?? '') : jail;
  const activeIp = ip.trim();
  const canQueue = activeJail !== '' && activeIp.length > 0;

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <p className="text-sm font-medium">Queue an unban by address</p>
      <div className="flex flex-wrap items-end gap-2">
        {jailNames.length > 0 && (
          <div className="w-48">
            <Select
              label="Jail"
              value={activeJail}
              onChange={(event) => setJail(event.target.value)}
              options={jailNames.map((name) => ({ value: name, label: name }))}
            />
          </div>
        )}
        <div className="w-56">
          <Input
            label="IP address"
            value={ip}
            onChange={(event) => setIp(event.target.value)}
            placeholder="10.0.0.5"
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!canQueue}
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
      {prompt.feedback !== null && <p className="text-sm text-muted-foreground">{prompt.feedback}</p>}
      <ReasonDialog request={prompt.request} onClose={prompt.close} onSubmit={prompt.submit} />
    </div>
  );
}
