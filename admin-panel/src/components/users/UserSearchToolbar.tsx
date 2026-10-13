'use client';

import { Button } from '@/components/core/Button';
import { TableToolbar } from '@/components/core/TableToolbar';

import type { UserListRows } from './useUserListRows';

export interface UserSearchToolbarProps {
  readonly rows: UserListRows;
  readonly canManage: boolean;
  readonly selectedCount: number;
  readonly unavailableCount: number;
  readonly onBulkEdit: () => void;
}

export function UserSearchToolbar({ rows, canManage, selectedCount, unavailableCount, onBulkEdit }: UserSearchToolbarProps): React.JSX.Element {
  return (
    <TableToolbar
      searchText={rows.searchDraft}
      onSearchTextChange={rows.setSearchDraft}
      onSearchSubmit={() => { rows.searchUsers(rows.searchDraft); }}
      searchPlaceholder="Search users..."
      rightContent={
        canManage ? (
          <div className="flex flex-wrap items-center gap-3">
            {unavailableCount > 0 && (
              <span className="text-xs text-warning">
                {unavailableCount} selected row(s) are not loaded
              </span>
            )}
            <Button variant="secondary" onClick={onBulkEdit} disabled={selectedCount === 0}>
              Edit Selected ({selectedCount})
            </Button>
          </div>
        ) : null
      }
    />
  );
}
