'use client';

import { Button } from '@/components/core/Button';
import { TableToolbar } from '@/components/core/TableToolbar';

import type { UserListRows } from './useUserListRows';

export interface UserSearchToolbarProps {
  readonly rows: UserListRows;
  readonly canManage: boolean;
  readonly selectedCount: number;
  readonly onBulkEdit: () => void;
}

export function UserSearchToolbar({ rows, canManage, selectedCount, onBulkEdit }: UserSearchToolbarProps): React.JSX.Element {
  return (
    <TableToolbar
      searchText={rows.searchDraft}
      onSearchTextChange={rows.setSearchDraft}
      onSearchSubmit={() => { void rows.fetchUsers({ page: 1, search: rows.searchDraft }); }}
      searchPlaceholder="Search users..."
      rightContent={
        canManage ? (
          <Button variant="secondary" onClick={onBulkEdit} disabled={selectedCount === 0}>
            Edit Selected ({selectedCount})
          </Button>
        ) : null
      }
    />
  );
}
