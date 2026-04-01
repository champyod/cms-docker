'use client';

import { useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { Button } from '@/components/core/Button';
import { Edit2, Trash2, Plus, HelpCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { UserModal } from './UserModal';
import { apiClient } from '@/lib/apiClient';
import { UserBulkCreateCsv } from './UserBulkCreateCsv';
import { UserBulkEditDialog } from './UserBulkEditDialog';

interface UserListProps {
  initialUsers: any[];
  totalPages: number;
  currentPage: number;
  perPage: number;
  initialSearch: string;
  contests: Array<{ id: number; name: string }>;
  permissions: {
    permission_all: boolean;
    permission_tasks: boolean;
    permission_users: boolean;
    permission_contests: boolean;
    permission_messaging: boolean;
  };
}

export function UserList({ initialUsers, totalPages, currentPage, perPage, initialSearch, contests, permissions }: UserListProps) {
  const [usersList] = useState(initialUsers);
  const [searchText, setSearchText] = useState(initialSearch);
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [perPageValue, setPerPageValue] = useState(perPage);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname.split('/')[1] || 'en';

  const isSuperAdmin = permissions?.permission_all ?? false;
  const canManageUsers = isSuperAdmin || (permissions?.permission_users ?? false);

  const selectedUsers = useMemo(
    () => usersList.filter((user: any) => selectedIds.has(user.id)),
    [usersList, selectedIds]
  );

  const handleEdit = (user: any) => {
    if (!canManageUsers) return;
    setSelectedUser(user);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!canManageUsers) return;
    if (confirm('Are you sure you want to delete this user?')) {
      const result = await apiClient.delete(`/api/users/${id}`);
      if (result.success) {
         window.location.reload(); 
      } else {
        alert('Failed to delete user');
      }
    }
  };

  const handleCreate = () => {
    if (!canManageUsers) return;
    setSelectedUser(null);
    setIsModalOpen(true);
  };

  const handleSuccess = () => {
    window.location.reload();
  };

  const navigate = (next: { page?: number; search?: string; perPage?: number }) => {
    const params = new URLSearchParams(window.location.search);

    const targetSearch = next.search ?? searchText;
    const targetPage = Math.max(next.page ?? currentPage, 1);
    const targetPerPage = next.perPage ?? perPageValue;

    if (targetSearch) params.set('search', targetSearch);
    else params.delete('search');

    params.set('page', String(targetPage));
    params.set('perPage', String(targetPerPage));

    router.push(`${pathname}?${params.toString()}`);
  };

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    navigate({ page: 1, search: searchText });
  };

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(usersList.map((user: any) => user.id)));
  };

  const toggleOne = (userId: number, checked: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  };

  const allSelected = usersList.length > 0 && usersList.every((user: any) => selectedIds.has(user.id));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-white">All Users</h2>
          <Link href={`/${locale}/docs#users`} className="p-1 hover:bg-white/10 rounded-full transition-colors text-neutral-400 hover:text-white" title="View Documentation">
            <HelpCircle className="w-4 h-4" />
          </Link>
        </div>
        {canManageUsers && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="flex items-center gap-2"
              onClick={() => setIsBulkModalOpen(true)}
            >
              <Plus className="w-4 h-4" />
              Bulk Add Users
            </Button>
            <Button 
                variant="primary" 
                className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white pl-3 pr-4"
                onClick={handleCreate}
            >
              <Plus className="w-4 h-4" />
              Create User
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-neutral-900/40 p-3">
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search users..."
            className="w-72 max-w-[60vw] bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
          />
          <Button variant="ghost" type="submit">Search</Button>
        </form>

        {canManageUsers && (
          <Button variant="ghost" onClick={() => setIsBulkEditOpen(true)} disabled={selectedIds.size === 0}>
            Edit Selected ({selectedIds.size})
          </Button>
        )}
      </div>

      <div className="border border-white/5 rounded-xl overflow-hidden bg-neutral-900/40 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-white/5 hover:bg-white/5">
              <TableHead className="text-neutral-400 w-10">
                <input
                  type="checkbox"
                  title="Select all users"
                  checked={allSelected}
                  onChange={(event) => toggleAll(event.target.checked)}
                />
              </TableHead>
              <TableHead className="text-neutral-400">ID</TableHead>
              <TableHead className="text-neutral-400">Name</TableHead>
              <TableHead className="text-neutral-400">Username</TableHead>
              <TableHead className="text-neutral-400">Email</TableHead>
              <TableHead className="text-neutral-400 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usersList.map((user: any) => (
              <TableRow key={user.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <TableCell>
                  <input
                    type="checkbox"
                    title={`Select user ${user.id}`}
                    checked={selectedIds.has(user.id)}
                    onChange={(event) => toggleOne(user.id, event.target.checked)}
                  />
                </TableCell>
                <TableCell className="font-mono text-neutral-500 text-xs">#{user.id}</TableCell>
                <TableCell className="font-medium text-white">{user.first_name} {user.last_name}</TableCell>
                <TableCell className="text-neutral-300">{user.username}</TableCell>
                <TableCell className="text-neutral-400">{user.email || '-'}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {canManageUsers && (
                      <>
                        <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleEdit(user)}
                            className="h-8 w-8 p-0 text-neutral-400 hover:text-indigo-400"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleDelete(user.id)}
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
            {usersList.length === 0 && (
                <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-neutral-500">
                        No users found.
                    </TableCell>
                </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-neutral-300">
        <Button variant="ghost" size="sm" disabled={currentPage <= 1} onClick={() => navigate({ page: currentPage - 1 })}>
          {'<-'}
        </Button>
        <span>{currentPage}/{totalPages}</span>
        <Button variant="ghost" size="sm" disabled={currentPage >= totalPages} onClick={() => navigate({ page: currentPage + 1 })}>
          {'->'}
        </Button>

        <span className="ml-2 text-neutral-400">page</span>
        <input
          type="number"
          min={1}
          max={totalPages}
          value={pageInput}
          title="Page number"
          placeholder="Page"
          onChange={(event) => setPageInput(event.target.value)}
          className="w-20 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-sm text-white"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const parsed = Number(pageInput);
            if (!Number.isFinite(parsed)) return;
            navigate({ page: Math.min(Math.max(parsed, 1), totalPages) });
          }}
        >
          Go
        </Button>

        <span className="ml-2 text-neutral-400">per page</span>
        <select
          value={perPageValue}
          title="Users per page"
          onChange={(event) => {
            const nextPerPage = Number(event.target.value) || 20;
            setPerPageValue(nextPerPage);
            navigate({ page: 1, perPage: nextPerPage });
          }}
          className="bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-sm text-white"
        >
          {[10, 20, 50, 100].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </div>
      
      <UserModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        user={selectedUser}
        onSuccess={handleSuccess}
      />

      {canManageUsers && (
        <UserBulkCreateCsv
          isOpen={isBulkModalOpen}
          onClose={() => setIsBulkModalOpen(false)}
          onSuccess={handleSuccess}
        />
      )}

      {canManageUsers && (
        <UserBulkEditDialog
          isOpen={isBulkEditOpen}
          onClose={() => setIsBulkEditOpen(false)}
          selectedUsers={selectedUsers}
          contests={contests}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}
