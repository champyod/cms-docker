'use client';

import { Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/core/Button';

interface BulkEditPreviewTableProperties {
  rows: Array<{
    id: number;
    first_name: string;
    last_name: string;
    username: string;
    password?: string | null;
    email?: string | null;
    stored_kind?: 'bcrypt' | 'plaintext';
  }>;
  revealedIds: number[];
  revealingIds?: number[];
  onToggleRevealRow: (rowId: number) => void;
  onToggleAllRevealed: () => void;
  allRevealed: boolean;
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
    <div className="border border-border rounded-lg overflow-hidden">
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
                    {isRevealed(row.id) && row.password ? (
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
                    ) : row.stored_kind === 'bcrypt' ? (
                      <span className="text-muted-foreground/50">bcrypt ••••</span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Eye}
                        iconOnly
                        tooltip={`Reveal password for ${row.username}`}
                        loading={isRevealing(row.id)}
                        onClick={() => onToggleRevealRow(row.id)}
                      />
                    )}
                  </td>
                  <td className="px-2 py-2">{row.email ?? '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
