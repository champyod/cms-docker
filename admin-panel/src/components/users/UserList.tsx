'use client';

import { useCallback, useMemo, useState } from 'react';
import { FileSpreadsheet, HelpCircle, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/core/Button';
import { apiClient, type ApiResponse } from '@/lib/apiClient';

import { UserBulkCreateCsv } from './UserBulkCreateCsv';
import { UserBulkEditDialog } from './UserBulkEditDialog';
import { UserModal } from './UserModal';
import { UserTable } from './UserTable';
import { TableToolbar } from '@/components/core/TableToolbar';
import { TablePaginationControls } from '@/components/core/TablePaginationControls';
import { useTable } from '@/hooks/useTable';
import { useTableAutoRefresh } from '@/hooks/useTableAutoRefresh';
import type { UsersPageRow } from '@/lib/prisma-selects';

interface UserListProps {
  initialUsers: UsersPageRow[];
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

function mergeIntoCache(prev: Record<number, UsersPageRow>, users: UsersPageRow[]): Record<number, UsersPageRow> {
  const next = { ...prev };
  users.forEach((user) => { next[user.id] = user; });
  return next;
}

export function UserList({ initialUsers, totalPages, currentPage, perPage, initialSearch, contests, permissions }: UserListProps) {
  const [usersList, setUsersList] = useState(initialUsers);
  const [userCache, setUserCache] = useState<Record<number, UsersPageRow>>(() => mergeIntoCache({}, initialUsers));
  const [totalPagesState, setTotalPagesState] = useState(totalPages);
  const [loadingList, setLoadingList] = useState(false);
  const [searchDraft, setSearchDraft] = useState(initialSearch);
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UsersPageRow | null>(null);
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

      const result = (await apiClient.get(`/api/users?${query.toString()}`)) as ApiResponse & { users?: UsersPageRow[]; totalPages?: number; currentPage?: number; perPage?: number; search?: string };
      if (!result.success) return;

      setUsersList(result.users || []);
      setUserCache((prev) => mergeIntoCache(prev, result.users || []));
      setTotalPagesState(result.totalPages || 1);
      table.setPage(result.currentPage || targetPage);
      table.setPerPage(result.perPage || targetPerPage);
      table.setSearch(result.search ?? targetSearch);
      setPageInput(String(result.currentPage || targetPage));
      // Selection survives refreshes so bulk actions and local previews stay visible until explicitly cleared.
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

  const handleEdit = (user: UsersPageRow) => {
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
    setSelectedIds((previous) => {
      const next = new Set(previous);
      usersList.forEach((user) => {
        if (checked) next.add(user.id);
        else next.delete(user.id);
      });
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-foreground">All Users</h2>
          <Link
            href={`/${locale}/docs#users`}
            className="p-1 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-foreground"
            title="View Documentation"
          >
            <HelpCircle className="w-4 h-4" />
          </Link>
        </div>
        {canManageUsers && (
          <div className="flex items-center gap-2">
            <Button variant="positiveOutline" icon={FileSpreadsheet} onClick={() => setIsBulkModalOpen(true)}>
              Bulk Add Users
            </Button>
            <Button variant="positive" icon={Plus} onClick={handleCreate}>
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
            <Button variant="secondary" onClick={() => setIsBulkEditOpen(true)} disabled={selectedIds.size === 0}>
              Edit Selected ({selectedIds.size})
            </Button>
          ) : null
        }
      />

      <UserTable
        users={usersList}
        loading={loadingList}
        selectedIds={selectedIds}
        canManageUsers={canManageUsers}
        pageNumber={table.page}
        perPage={table.perPage}
        onToggleAll={toggleAll}
        onToggleOne={toggleOne}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

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
