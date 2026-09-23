'use client';

import { useMemo } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';

interface BulkEditPreviewRow {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
  password?: string | null;
  email?: string | null;
  stored_kind?: 'bcrypt' | 'plaintext';
}

interface BulkEditPreviewTableProperties {
  rows: BulkEditPreviewRow[];
  revealedIds: number[];
  revealingIds?: number[];
  onToggleRevealRow: (rowId: number) => void;
  onToggleAllRevealed: () => void;
  allRevealed: boolean;
}

function passwordContent(row: BulkEditPreviewRow, revealed: boolean, revealing: boolean, onToggleRevealRow: (rowId: number) => void): React.JSX.Element {
  if (revealed && row.password) {
    return (
      <span className="inline-flex items-center gap-1">
        {row.password}
        <Button
          variant="ghost"
          size="sm"
          icon={EyeOff}
          iconOnly
          tooltip={`Hide password for ${row.username}`}
          onClick={() => onToggleRevealRow(row.id)}
        />
      </span>
    );
  }
  if (row.stored_kind === 'bcrypt') {
    return <span className="text-muted-foreground/50">bcrypt ••••</span>;
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={Eye}
      iconOnly
      tooltip={`Reveal password for ${row.username}`}
      loading={revealing}
      onClick={() => onToggleRevealRow(row.id)}
    />
  );
}

// Why: one column definition drives desktop rows and mobile cards, so
// the two layouts cannot drift apart. Reveal buttons stay Button
// size="sm" iconOnly (h-11/w-11) so both layouts keep 44px targets.
function buildBulkEditColumns(args: {
  revealedIds: number[];
  revealingIds: number[];
  allRevealed: boolean;
  onToggleRevealRow: (rowId: number) => void;
  onToggleAllRevealed: () => void;
}): ResponsiveColumn<BulkEditPreviewRow>[] {
  const { revealedIds, revealingIds, allRevealed, onToggleRevealRow, onToggleAllRevealed } = args;
  const isRevealed = (rowId: number): boolean => revealedIds.includes(rowId);
  const isRevealing = (rowId: number): boolean => revealingIds.includes(rowId);
  return [
    {
      key: 'id',
      header: 'ID',
      render: (row) => <span className="text-muted-foreground">#{row.id}</span>,
      hideOnMobile: true,
    },
    {
      key: 'first_name',
      header: 'first_name',
      render: (row) => row.first_name,
    },
    {
      key: 'last_name',
      header: 'last_name',
      render: (row) => row.last_name,
    },
    {
      key: 'username',
      header: 'username',
      render: (row) => row.username,
    },
    {
      key: 'password',
      header: (
        <span className="inline-flex items-center gap-1">
          password
          <Button
            variant="ghost"
            size="sm"
            icon={allRevealed ? EyeOff : Eye}
            iconOnly
            tooltip={allRevealed ? 'Hide all passwords' : 'Reveal all passwords'}
            onClick={onToggleAllRevealed}
          />
        </span>
      ),
      render: (row) => (
        <span className="font-mono">
          {passwordContent(row, isRevealed(row.id), isRevealing(row.id), onToggleRevealRow)}
        </span>
      ),
    },
    {
      key: 'email',
      header: 'email',
      render: (row) => row.email ?? '-',
    },
  ];
}

export function BulkEditPreviewTable({
  rows,
  revealedIds,
  revealingIds = [],
  onToggleRevealRow,
  onToggleAllRevealed,
  allRevealed,
}: BulkEditPreviewTableProperties): React.JSX.Element {
  const columns = useMemo(
    () => buildBulkEditColumns({ revealedIds, revealingIds, allRevealed, onToggleRevealRow, onToggleAllRevealed }),
    [revealedIds, revealingIds, allRevealed, onToggleRevealRow, onToggleAllRevealed],
  );

  return (
    <ResponsiveTable
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.id}
      outerClassName="max-h-80"
      emptyState={<div className="py-2 text-center text-xs text-muted-foreground">No selected users</div>}
    />
  );
}
