'use client';

import { Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { MobileCard, MobileCardRow } from '@/components/core/MobileCard';

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

interface MobilePreviewCardsProperties {
  rows: BulkEditPreviewRow[];
  revealedIds: number[];
  revealingIds: number[];
  onToggleRevealRow: (rowId: number) => void;
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

function MobilePreviewCards({ rows, revealedIds, revealingIds, onToggleRevealRow }: MobilePreviewCardsProperties): React.JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((row) => (
        <MobileCard key={row.id}>
          <MobileCardRow label="Name" value={`${row.first_name} ${row.last_name}`} />
          <MobileCardRow label="Username" value={row.username} />
          <MobileCardRow label="Password" value={passwordContent(row, revealedIds.includes(row.id), revealingIds.includes(row.id), onToggleRevealRow)} />
          <MobileCardRow label="Email" value={row.email ?? '-'} />
        </MobileCard>
      ))}
    </>
  );
}

export function BulkEditPreviewTable({
  rows,
  revealedIds,
  revealingIds = [],
  onToggleRevealRow,
  onToggleAllRevealed,
  allRevealed,
}: BulkEditPreviewTableProperties): React.JSX.Element {
  const isRevealed = (rowId: number): boolean => revealedIds.includes(rowId);
  const isRevealing = (rowId: number): boolean => revealingIds.includes(rowId);

  return (
    <>
      <div className="space-y-3 md:hidden">
        {rows.length === 0 ? (
          <MobileCard>
            <div className="py-2 text-center text-xs text-muted-foreground">No selected users</div>
          </MobileCard>
        ) : (
          <MobilePreviewCards rows={rows} revealedIds={revealedIds} revealingIds={revealingIds} onToggleRevealRow={onToggleRevealRow} />
        )}
      </div>
      <div className="hidden border border-border rounded-lg overflow-hidden md:block">
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground sticky top-0 z-10">
            <tr>
              <th className="text-left px-2 py-2">ID</th>
              <th className="text-left px-2 py-2">first_name</th>
              <th className="text-left px-2 py-2">last_name</th>
              <th className="text-left px-2 py-2">username</th>
              <th className="text-left px-2 py-2">
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
              </th>
              <th className="text-left px-2 py-2">email</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  No selected users
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-2 py-2 text-muted-foreground">#{row.id}</td>
                  <td className="px-2 py-2">{row.first_name}</td>
                  <td className="px-2 py-2">{row.last_name}</td>
                  <td className="px-2 py-2">{row.username}</td>
                  <td className="px-2 py-2 font-mono">
                    {passwordContent(row, isRevealed(row.id), isRevealing(row.id), onToggleRevealRow)}
                  </td>
                  <td className="px-2 py-2">{row.email ?? '-'}</td>
                </tr>
              ))
            )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
