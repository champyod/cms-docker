'use client';

import { Button } from '@/components/core/Button';
import { TableToolbar } from '@/components/core/TableToolbar';
import { useDictionary } from '@/hooks/useDictionary';
import { interpolate } from '@/lib/interpolate';

import type { UserListRows } from './useUserListRows';

export interface UserSearchToolbarProps {
  readonly rows: UserListRows;
  readonly canManage: boolean;
  readonly selectedCount: number;
  readonly unavailableCount: number;
  readonly onBulkEdit: () => void;
}

export function UserSearchToolbar({ rows, canManage, selectedCount, unavailableCount, onBulkEdit }: UserSearchToolbarProps): React.JSX.Element {
  const dict = useDictionary();
  return (
    <TableToolbar
      searchText={rows.searchDraft}
      onSearchTextChange={rows.setSearchDraft}
      onSearchSubmit={() => { rows.searchUsers(rows.searchDraft); }}
      searchPlaceholder={dict.users.searchPlaceholder}
      rightContent={
        canManage ? (
          <div className="flex flex-wrap items-center gap-3">
            {unavailableCount > 0 && (
              <span className="text-xs text-warning">
                {interpolate(dict.users.selectedUnavailable, { count: unavailableCount })}
              </span>
            )}
            {/* Why the count rides the label: the operator sees how many rows the bulk edit will
                touch before it runs, rather than after. */}
            <Button variant="secondary" onClick={onBulkEdit} disabled={selectedCount === 0}>
              {interpolate(dict.users.editSelectedCount, { count: selectedCount })}
            </Button>
          </div>
        ) : null
      }
    />
  );
}
