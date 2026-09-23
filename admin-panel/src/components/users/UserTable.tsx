'use client';

import { useCallback, useMemo } from 'react';
import { Edit2, Trash2, Users } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { ResponsiveTable } from '@/components/core/ResponsiveTable';
import { Skeleton } from '@/components/core/Skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { ROW_SELECTED_CLASSES } from '@/hooks/useShortcuts';
import { CHECKBOX_CLASS, buildUserColumns, getUserRowProps } from './userColumns';
import type { UserRow, UserTableProps } from './userTableTypes';

export function UserTable({
  users,
  loading,
  selectedIds,
  canManageUsers,
  pageNumber,
  perPage,
  onToggleAll,
  onToggleOne,
  onEdit,
  onDelete,
}: UserTableProps) {
  const allSelected = users.length > 0 && users.every((user) => selectedIds.has(user.id));

  const rows = useMemo<UserRow[]>(
    () => users.map((user, index) => ({ user, position: (pageNumber - 1) * perPage + index + 1 })),
    [users, pageNumber, perPage],
  );

  const columns = useMemo(
    () => buildUserColumns({ selectedIds, allSelected, onToggleAll, onToggleOne }),
    [selectedIds, allSelected, onToggleAll, onToggleOne],
  );

  const getRowClassName = (row: UserRow): string | undefined =>
    selectedIds.has(row.user.id) ? ROW_SELECTED_CLASSES.join(' ') : undefined;

  // Why: shared by desktop rows and mobile cards, with 44px targets kept
  // in this fragment so both layouts stay touch-sized.
  const renderRowActions = useCallback(
    (row: UserRow) => {
      if (!canManageUsers) return null;
      const { user } = row;
      return (
        <>
          <Button
            variant="ghost"
            size="sm"
            icon={Edit2}
            iconOnly
            tooltip={`Edit user ${user.username}`}
            data-shortcut-primary
            className="min-h-11 min-w-11"
            onClick={() => onEdit(user)}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            iconOnly
            tooltip={`Delete user ${user.username}`}
            className="min-h-11 min-w-11"
            onClick={() => onDelete(user.id)}
          />
        </>
      );
    },
    [canManageUsers, onEdit, onDelete],
  );

  if (loading && users.length === 0) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                title="Select all users"
                className={CHECKBOX_CLASS}
                checked={allSelected}
                onChange={(event) => onToggleAll(event.target.checked)}
              />
            </TableHead>
            <TableHead>#</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Username</TableHead>
            <TableHead>Team</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>ID</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Organization</TableHead>
            <TableHead>Country</TableHead>
            <TableHead>Contests</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[0, 1, 2, 3, 4].map((rowIndex) => (
            <TableRow key={`skeleton-${rowIndex}`}>
              <TableCell colSpan={12}>
                <Skeleton className="h-5 w-full" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <ResponsiveTable
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.user.id}
      getRowProps={getUserRowProps}
      getRowClassName={getRowClassName}
      renderRowActions={renderRowActions}
      emptyState={
        <EmptyState icon={Users} title="No users found." description="Adjust your search or create a new user to get started." />
      }
    />
  );
}
