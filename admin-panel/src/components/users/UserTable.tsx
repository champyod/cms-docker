'use client';

import { useCallback, useMemo } from 'react';
import { Edit2, Trash2, Users } from 'lucide-react';

import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import {
  ResponsiveTable,
  type ResponsiveColumn,
  type ResponsiveRowProps,
} from '@/components/core/ResponsiveTable';
import { Skeleton } from '@/components/core/Skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { ROW_SELECTED_CLASSES } from '@/hooks/useShortcuts';
import type { UsersPageRow } from '@/lib/prisma-selects';

interface UserTableProps {
  users: UsersPageRow[];
  loading: boolean;
  selectedIds: Set<number>;
  canManageUsers: boolean;
  pageNumber: number;
  perPage: number;
  onToggleAll: (checked: boolean) => void;
  onToggleOne: (userId: number, checked: boolean) => void;
  onEdit: (user: UsersPageRow) => void;
  onDelete: (id: number) => void;
}

// Why: position is precomputed so the shared column model stays a pure
// row-to-node map without needing a row index at render time.
interface UserRow {
  user: UsersPageRow;
  position: number;
}

function teamCodes(user: UsersPageRow): string {
  const codes = (user.participations || [])
    .map((participation: UsersPageRow['participations'][number]) => participation?.teams?.code)
    .filter(Boolean);
  return Array.from(new Set(codes)).join(', ') || '-';
}

const CHECKBOX_CLASS = 'size-4 accent-primary cursor-pointer';

// Why: one column definition drives desktop rows and mobile cards, so
// the two layouts cannot drift apart.
function buildUserColumns(args: {
  selectedIds: Set<number>;
  allSelected: boolean;
  onToggleAll: (checked: boolean) => void;
  onToggleOne: (userId: number, checked: boolean) => void;
}): ResponsiveColumn<UserRow>[] {
  const { selectedIds, allSelected, onToggleAll, onToggleOne } = args;
  return [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          title="Select all users"
          className={CHECKBOX_CLASS}
          checked={allSelected}
          onChange={(event) => onToggleAll(event.target.checked)}
        />
      ),
      render: ({ user }) => (
        <input
          type="checkbox"
          title={`Select user ${user.id}`}
          className={CHECKBOX_CLASS}
          checked={selectedIds.has(user.id)}
          onChange={(event) => onToggleOne(user.id, event.target.checked)}
        />
      ),
      hideOnMobile: true,
    },
    {
      key: 'position',
      header: '#',
      render: ({ position }) => (
        <span className="font-mono text-muted-foreground text-xs">#{position}</span>
      ),
      hideOnMobile: true,
    },
    {
      key: 'name',
      header: 'Name',
      render: ({ user }) => (
        <span className="font-medium">{user.first_name} {user.last_name}</span>
      ),
    },
    {
      key: 'username',
      header: 'Username',
      render: ({ user }) => <span>{user.username}</span>,
    },
    {
      key: 'team',
      header: 'Team',
      render: ({ user }) => <span>{teamCodes(user)}</span>,
    },
    {
      key: 'email',
      header: 'Email',
      render: ({ user }) => (
        <span className="text-muted-foreground">{user.email || '-'}</span>
      ),
      hideOnMobile: true,
    },
    {
      key: 'id',
      header: 'ID',
      render: ({ user }) => (
        <span className="font-mono text-muted-foreground text-xs">#{user.id}</span>
      ),
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Status',
      render: ({ user }) =>
        user.status ? (
          <Badge variant={user.status === 'active' ? 'success' : 'warning'}>{user.status}</Badge>
        ) : (
          '—'
        ),
    },
    {
      key: 'organization',
      header: 'Organization',
      render: ({ user }) => <span>{user.organization ?? '—'}</span>,
      hideOnMobile: true,
    },
    {
      key: 'country',
      header: 'Country',
      render: ({ user }) => <span>{user.country ?? '—'}</span>,
      hideOnMobile: true,
    },
    {
      key: 'contests',
      header: 'Contests',
      render: ({ user }) => <span>{user._count?.participations ?? 0}</span>,
    },
  ];
}

// Why: j/k navigation queries [data-shortcut-row]; without this prop
// the migrated users list is invisible to the shortcut handler.
function getUserRowProps(row: UserRow): ResponsiveRowProps {
  return { 'data-shortcut-row': row.user.id, className: 'cursor-pointer' };
}

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
