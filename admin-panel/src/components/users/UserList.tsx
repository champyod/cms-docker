'use client';

import { useCallback, useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { Button } from '@/components/core/Button';
import { Edit2, Trash2, Plus, HelpCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserModal } from './UserModal';
import { apiClient } from '@/lib/apiClient';
import { UserBulkCreateCsv } from './UserBulkCreateCsv';
import { UserBulkEditDialog } from './UserBulkEditDialog';
import { TableToolbar } from '@/components/core/TableToolbar';
import { TablePaginationControls } from '@/components/core/TablePaginationControls';
import { useTable } from '@/hooks/useTable';
import { useTableAutoRefresh } from '@/hooks/useTableAutoRefresh';

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
  const [usersList, setUsersList] = useState(initialUsers);
  const [userCache, setUserCache] = useState<Record<number, any>>(() => {
    const map: Record<number, any> = {};
    initialUsers.forEach((u: any) => { map[u.id] = u; });
    return map;
  });
  const [totalPagesState, setTotalPagesState] = useState(totalPages);
  const [loadingList, setLoadingList] = useState(false);
  const [searchDraft, setSearchDraft] = useState(initialSearch);
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const table = useTable({ initialPage: currentPage, initialPerPage: perPage, initialSearch });
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';

  const isSuperAdmin = permissions?.permission_all ?? false;
  const canManageUsers = isSuperAdmin || (permissions?.permission_users ?? false);

  const fetchUsers = useCallback(async (next: { page?: number; perPage?: number; search?: string } = {}) => {
    const targetPage = Math.max(next.page ?? table.page, 1);
    const targetPerPage = next.perPage ?? table.perPage;
    const targetSearch = next.search ?? table.search;

    setLoadingList(true);
    try {
      const query = new URLSearchParams({
        page: String(targetPage),
        perPage: String(targetPerPage),
        search: targetSearch,
      });

      const result = await apiClient.get(`/api/users?${query.toString()}`);
      if (!result.success) return;

      setUsersList(result.users || []);
      // merge fetched users into local cache so we can remember selections
      setUserCache((prev) => {
        const next = { ...prev } as Record<number, any>;
        (result.users || []).forEach((u: any) => {
          next[u.id] = u;
        });
        return next;
      });
      setTotalPagesState(result.totalPages || 1);
      table.setPage(result.currentPage || targetPage);
      table.setPerPage(result.perPage || targetPerPage);
      table.setSearch(result.search ?? targetSearch);
      setPageInput(String(result.currentPage || targetPage));
      // Preserve current selection across refreshes so bulk actions and
      // local previews remain visible until the user explicitly clears them.
    } finally {
      setLoadingList(false);
    }
  }, [table]);

  const selectedUsers = useMemo(() => {
    return Array.from(selectedIds).map((id) => userCache[id]).filter(Boolean);
  }, [selectedIds, userCache]);

  useTableAutoRefresh({
    enabled: true,
    intervalMs: 60000,
    onRefresh: () => fetchUsers(),
  });

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
        await fetchUsers();
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
    fetchUsers();
  };

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        usersList.forEach((user: any) => next.delete(user.id));
        return next;
      });
      return;
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      usersList.forEach((user: any) => next.add(user.id));
      return next;
    });
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

      <TableToolbar
        searchText={searchDraft}
        onSearchTextChange={setSearchDraft}
        onSearchSubmit={() => fetchUsers({ page: 1, search: searchDraft })}
        searchPlaceholder="Search users..."
        rightContent={
          canManageUsers ? (
            <Button variant="ghost" onClick={() => setIsBulkEditOpen(true)} disabled={selectedIds.size === 0}>
              Edit Selected ({selectedIds.size})
            </Button>
          ) : null
        }
      />

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
            {usersList.map((user: any, index: number) => (
              <TableRow key={user.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <TableCell>
                  <input
                    type="checkbox"
                    title={`Select user ${user.id}`}
                    checked={selectedIds.has(user.id)}
                    onChange={(event) => toggleOne(user.id, event.target.checked)}
                  />
                </TableCell>
                <TableCell className="font-mono text-neutral-500 text-xs">#{(table.page - 1) * table.perPage + index + 1}</TableCell>
                <TableCell className="font-medium text-white">{user.first_name} {user.last_name}</TableCell>
                <TableCell className="text-neutral-300">{user.username}</TableCell>
                <TableCell className="text-neutral-300">
                  {Array.from(new Set((user.participations || []).map((participation: any) => participation?.teams?.code).filter(Boolean))).join(', ') || '-'}
                </TableCell>
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
            {!loadingList && usersList.length === 0 && (
                <TableRow>
                    <TableCell colSpan={12} className="text-center py-12 text-neutral-500">
                        No users found.
                    </TableCell>
                </TableRow>
            )}
            {loadingList && (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-12 text-neutral-500">
                  Loading users...
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <TablePaginationControls
        currentPage={table.page}
        totalPages={totalPagesState}
        pageInput={pageInput}
        onPageInputChange={setPageInput}
        onPageGo={() => {
          const parsed = Number(pageInput);
          if (!Number.isFinite(parsed)) return;
          fetchUsers({ page: Math.min(Math.max(parsed, 1), totalPagesState) });
        }}
        perPage={table.perPage}
        onPerPageChange={(value) => fetchUsers({ page: 1, perPage: value })}
        onPrev={() => fetchUsers({ page: table.page - 1 })}
        onNext={() => fetchUsers({ page: table.page + 1 })}
      />
      
      <UserModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        user={selectedUser}
        contests={contests}
        onSuccess={handleSuccess}
      />

      {canManageUsers && (
        <UserBulkCreateCsv
          isOpen={isBulkModalOpen}
          onClose={() => setIsBulkModalOpen(false)}
          contests={contests}
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
