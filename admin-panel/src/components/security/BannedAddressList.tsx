'use client';

import { queueUnban, type BannedAddressView } from '@/app/actions/securityBlocks';
import { Button } from '@/components/core/Button';
import { ReasonDialog } from '@/components/core/ReasonDialog';
import { useReasonPrompt } from '@/hooks/useReasonPrompt';

interface BannedAddressListProps {
  readonly bans: BannedAddressView['bans'];
}

function unbanDescription(ip: string, jail: string): string {
  return `Queue an unban for ${ip} in the ${jail} jail. The host agent applies it on its next tick.`;
}

/** The unban is an audited write, so the reason dialog belongs to the rows that ask for it. */
export function BannedAddressList({ bans }: BannedAddressListProps): React.JSX.Element {
  const prompt = useReasonPrompt();

  return (
    <div className="space-y-3">
      {prompt.feedback !== null && <p className="text-sm text-muted-foreground">{prompt.feedback}</p>}
      <ul className="space-y-2">
        {bans.map((ban) => (
          <li
            key={`${ban.jail}/${ban.ip}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3"
          >
            <span className="font-mono text-sm">
              {ban.ip}, {ban.jail}
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
      <ReasonDialog request={prompt.request} onClose={prompt.close} onSubmit={prompt.submit} />
    </div>
  );
}
