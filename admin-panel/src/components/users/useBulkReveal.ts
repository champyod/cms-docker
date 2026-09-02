'use client';

import { useState } from 'react';

import { revealUserPassword } from '@/app/actions/users';
import type { SelectedUser } from './bulkEditActions';

interface RevealState {
  revealedIds: number[];
  revealingIds: number[];
  allRevealed: boolean;
}

export function useBulkReveal(rows: SelectedUser[], setRows: (updater: (previous: SelectedUser[]) => SelectedUser[]) => void): RevealState & {
  revealRowPassword: (rowId: number) => Promise<void>;
  toggleAllRevealed: () => void;
} {
  const [revealingIds, setRevealingIds] = useState<number[]>([]);
  const [revealedIds, setRevealedIds] = useState<number[]>([]);

  const allRevealed = rows.length > 0 && rows.every((row) => revealedIds.includes(row.id));

  const revealRowPassword = async (rowId: number): Promise<void> => {
    setRevealingIds((previous) => [...previous, rowId]);
    try {
      if (!revealedIds.includes(rowId)) {
        const result = await revealUserPassword(rowId);
        setRows((previous) =>
          previous.map((row) =>
            row.id === rowId
              ? {
                  ...row,
                  password: result.success && result.kind === 'plaintext' ? result.value : row.password,
                  stored_kind: result.success ? result.kind : row.stored_kind,
                }
              : row
          )
        );
        if (!result.success || result.kind !== 'plaintext') {
          setRevealingIds((previous) => previous.filter((identifier) => identifier !== rowId));
          return;
        }
      }
      setRevealedIds((previous) =>
        previous.includes(rowId) ? previous.filter((identifier) => identifier !== rowId) : [...previous, rowId]
      );
    } catch {
      // keep hidden on failure
    }
    setRevealingIds((previous) => previous.filter((identifier) => identifier !== rowId));
  };

  const toggleAllRevealed = (): void => {
    if (allRevealed) {
      setRevealedIds([]);
      return;
    }
    setRevealingIds(rows.map((row) => row.id));
    void (async () => {
      try {
        const results = await Promise.all(
          rows.map(async (row) => ({ id: row.id, res: await revealUserPassword(row.id) }))
        );
        setRows((previous) =>
          previous.map((row) => {
            const hit = results.find((entry) => entry.id === row.id);
            if (!hit || !hit.res.success || hit.res.kind !== 'plaintext') {
              return { ...row, stored_kind: hit && hit.res.success ? ('bcrypt' as const) : row.stored_kind };
            }
            return { ...row, password: row.password ?? hit.res.value, stored_kind: 'plaintext' as const };
          })
        );
        setRevealedIds(rows.map((row) => row.id));
      } catch {
        // leave as-is
      }
      setRevealingIds([]);
    })();
  };

  return { revealedIds, revealingIds, allRevealed, revealRowPassword, toggleAllRevealed };
}
