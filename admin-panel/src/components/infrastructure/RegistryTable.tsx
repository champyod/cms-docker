'use client';

import { Button } from '@/components/core/Button';
import { useDictionary } from '@/hooks/useDictionary';

interface RegistryTableProps {
  headers: readonly string[];
  rows: readonly React.ReactNode[][];
  empty: string;
}

export function RegistryTable({ headers, rows, empty }: RegistryTableProps): React.JSX.Element {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground bg-muted/40 border border-border rounded-xl p-4">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto bg-muted/40 border border-border rounded-xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            {headers.map((header) => <th key={header} className="px-4 py-2 font-medium">{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-border">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-4 py-2 text-foreground">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface RowButtonsProps {
  onEdit?: () => void;
  onDelete: () => void;
}

export function RowButtons({ onEdit, onDelete }: RowButtonsProps): React.JSX.Element {
  const copy = useDictionary().infrastructure.services;
  return (
    <span className="flex justify-end gap-2">
      {onEdit !== undefined && <Button size="sm" variant="ghost" onClick={onEdit}>{copy.actions.edit}</Button>}
      <Button size="sm" variant="ghost" onClick={onDelete}>{copy.actions.remove}</Button>
    </span>
  );
}
