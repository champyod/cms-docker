'use client';

import type { ReactNode } from 'react';

import { ConfirmDialog } from '@/components/core/ConfirmDialog';
import { usePendingConfirmation } from '@/hooks/useConfirm';
import { settleConfirmation } from '@/lib/confirmation-store';

/**
 * Hosts the single confirmation dialog. One instance near the root serves every
 * `await confirm(...)` call in the panel.
 */
export function ConfirmProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const pending = usePendingConfirmation();
  return (
    <>
      {children}
      <ConfirmDialog confirmation={pending} onResolve={settleConfirmation} />
    </>
  );
}
