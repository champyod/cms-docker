'use client';

import { Edit2, Trash2, Users } from 'lucide-react';

import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { Skeleton } from '@/components/core/Skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { ROW_SELECTED_CLASSES } from '@/hooks/useShortcuts';
import { cn } from '@/lib/utils';
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

function teamCodes(user: UsersPageRow): string {
  const codes = (user.participations || [])
    .map((participation) => participation?.teams?.code)
    .filter(Boolean);
  return Array.from(new Set(codes)).join(', ') || '-';
}

const CHECKBOX_CLASS = 'size-4 accent-primary cursor-pointer';

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
        {users.map((user, index) => (
          <TableRow
            key={user.id}
            data-shortcut-row={user.id}
            className={cn('cursor-pointer', selectedIds.has(user.id) && ROW_SELECTED_CLASSES.join(' '))}
          >
            <TableCell>
              <input
                type="checkbox"
                title={`Select user ${user.id}`}
                className={CHECKBOX_CLASS}
                checked={selectedIds.has(user.id)}
                onChange={(event) => onToggleOne(user.id, event.target.checked)}
              />
            </TableCell>
            <TableCell className="font-mono text-muted-foreground text-xs">#{(pageNumber - 1) * perPage + index + 1}</TableCell>
            <TableCell className="font-medium">{user.first_name} {user.last_name}</TableCell>
            <TableCell>{user.username}</TableCell>
            <TableCell>{teamCodes(user)}</TableCell>
            <TableCell className="text-muted-foreground">{user.email || '-'}</TableCell>
            <TableCell className="font-mono text-muted-foreground text-xs">#{user.id}</TableCell>
            <TableCell>
              {user.status ? (
                <Badge variant={user.status === 'active' ? 'success' : 'warning'}>{user.status}</Badge>
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell>{user.organization ?? '—'}</TableCell>
            <TableCell>{user.country ?? '—'}</TableCell>
            <TableCell>{user._count?.participations ?? 0}</TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-2">
                {canManageUsers && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Edit2}
                      iconOnly
                      tooltip={`Edit user ${user.username}`}
                      data-shortcut-primary
                      onClick={() => onEdit(user)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      iconOnly
                      tooltip={`Delete user ${user.username}`}
                      onClick={() => onDelete(user.id)}
                    />
                  </>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
        {!loading && users.length === 0 && (
          <TableRow>
            <TableCell colSpan={12} className="py-12">
              <EmptyState icon={Users} title="No users found." description="Adjust your search or create a new user to get started." />
            </TableCell>
          </TableRow>
        )}
        {loading && (
          <>
            {[0, 1, 2, 3, 4].map((rowIndex) => (
              <TableRow key={`skeleton-${rowIndex}`}>
                <TableCell colSpan={12}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            ))}
          </>
        )}
      </TableBody>
    </Table>
  );
}
