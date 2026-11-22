'use client';

import { unlockLoginLockout } from '@/app/actions/securityBlocks';
import { Button } from '@/components/core/Button';
import { ReasonDialog } from '@/components/core/ReasonDialog';
import { useReasonPrompt } from '@/hooks/useReasonPrompt';
import type { SecurityBlock } from '@/lib/security/block-ledger';

interface LockoutListProps {
  readonly lockouts: readonly SecurityBlock[];
}

/**
 * The open lockouts, one line per account and address.
 *
 * WHY the unlock carries its own prompt: lifting a lockout clears the counter and closes the
 * record, which is an audited write, so the reason lives beside the button that asks for it. The
 * rows draw no frame of their own — the board section is the frame.
 */
export function LockoutList({ lockouts }: LockoutListProps): React.JSX.Element {
  const prompt = useReasonPrompt();

  return (
    <div className="space-y-3">
      {prompt.feedback !== null && <p className="text-sm text-muted-foreground">{prompt.feedback}</p>}
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
                {lockout.subject ?? 'unknown'}, {lockout.ip ?? 'local'}, until{' '}
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
      <ReasonDialog request={prompt.request} onClose={prompt.close} onSubmit={prompt.submit} />
    </div>
  );
}
