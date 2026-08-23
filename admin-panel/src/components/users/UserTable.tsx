'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { Button } from '@/components/core/Button';
import { Edit2, Trash2 } from 'lucide-react';
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
    <div className="border border-white/5 rounded-xl overflow-hidden bg-neutral-900/40 backdrop-blur-sm">
      <Table>
        <TableHeader>
          <TableRow className="border-b border-white/5 hover:bg-white/5">
            <TableHead className="text-neutral-400 w-10">
              <input
                type="checkbox"
                title="Select all users"
                checked={allSelected}
                onChange={(event) => onToggleAll(event.target.checked)}
              />
            </TableHead>
            <TableHead className="text-neutral-400">#</TableHead>
            <TableHead className="text-neutral-400">Name</TableHead>
            <TableHead className="text-neutral-400">Username</TableHead>
            <TableHead className="text-neutral-400">Team</TableHead>
            <TableHead className="text-neutral-400">Email</TableHead>
            <TableHead className="text-neutral-400">ID</TableHead>
            <TableHead className="text-neutral-400">Status</TableHead>
            <TableHead className="text-neutral-400">Organization</TableHead>
            <TableHead className="text-neutral-400">Country</TableHead>
            <TableHead className="text-neutral-400">Contests</TableHead>
            <TableHead className="text-neutral-400 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user, index) => (
            <TableRow key={user.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
              <TableCell>
                <input
                  type="checkbox"
                  title={`Select user ${user.id}`}
                  checked={selectedIds.has(user.id)}
                  onChange={(event) => onToggleOne(user.id, event.target.checked)}
                />
              </TableCell>
              <TableCell className="font-mono text-neutral-500 text-xs">#{(pageNumber - 1) * perPage + index + 1}</TableCell>
              <TableCell className="font-medium text-white">{user.first_name} {user.last_name}</TableCell>
              <TableCell className="text-neutral-300">{user.username}</TableCell>
              <TableCell className="text-neutral-300">{teamCodes(user)}</TableCell>
              <TableCell className="text-neutral-400">{user.email || '-'}</TableCell>
              <TableCell className="font-mono text-neutral-500 text-xs">#{user.id}</TableCell>
              <TableCell>
                {user.status ? (
                  <span
                    className={
                      user.status === 'active'
                        ? 'px-2 py-0.5 rounded-full text-xs bg-emerald-500/20 text-emerald-400'
                        : 'px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-400'
                    }
                  >
                    {user.status}
                  </span>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell className="text-neutral-300">{user.organization ?? '—'}</TableCell>
              <TableCell className="text-neutral-300">{user.country ?? '—'}</TableCell>
              <TableCell className="text-neutral-300">{user._count?.participations ?? 0}</TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  {canManageUsers && (
                    <>
                      <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEdit(user)}
                          className="h-8 w-8 p-0 text-neutral-400 hover:text-indigo-400"
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(user.id)}
                          className="h-8 w-8 p-0 text-neutral-400 hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {!loading && users.length === 0 && (
              <TableRow>
                  <TableCell colSpan={12} className="text-center py-12 text-neutral-500">
                      No users found.
                  </TableCell>
              </TableRow>
          )}
          {loading && (
            <TableRow>
              <TableCell colSpan={12} className="text-center py-12 text-neutral-500">
                Loading users...
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
