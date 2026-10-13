'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSyncedState } from '@/hooks/useSyncedState';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { ShieldAlert, Plus, ShieldCheck } from 'lucide-react';
import { updateAdmin, deleteAdmin } from '@/app/actions/admins';
import { listAdminsAccessSummary, type AdminAccessSummary } from '@/app/actions/adminPermissions';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useDictionary } from '@/hooks/useDictionary';
import { usePublishModuleActions } from '@/components/navigation/ModuleActionSlot';
import { useFormatTimestamp } from '@/components/layout/TimezoneProvider';
import { ACTION_PERMISSIONS, hasEffectivePermission } from '@/lib/permission-engine';
import { type ListSortInput } from '@/lib/list-sorting';
import { cn } from '@/lib/utils';
import { AdminModal } from './AdminModal';
import { AdminRowActions } from './AdminRowActions';
import type { AdminCapabilities } from './adminCapabilities';
import type { AdminWithLogin } from '@/lib/prisma-selects';

interface AdminListProps {
  initialAdmins: AdminWithLogin[];
  initialSort?: ListSortInput;
  callerPermissions: string[];
  capabilities: AdminCapabilities;
  actionLabels: { edit: string; delete: string };
}

export function AdminList({
  initialAdmins,
  initialSort,
  callerPermissions,
  capabilities,
  actionLabels,
}: AdminListProps) {
  const [admins] = useSyncedState(initialAdmins);
  const [accessSummary, setAccessSummary] = useState<Record<number, AdminAccessSummary>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminWithLogin | null>(null);
  const dict = useDictionary();
  const router = useRouter();
  const confirm = useConfirm();
  // Why: an admin account outlives every contest, so its sign-in time has no owner contest and
  // reads in the operator's own zone.
  const formatTimestamp = useFormatTimestamp();
  const { destructiveConfirm } = useConfirmationCopy();
  const canUpdate = hasEffectivePermission(new Set(callerPermissions), ACTION_PERMISSIONS.updateAdmin);
  // Why the pair: the Actions column and the row's own click both admit `updateAdmin`'s either
  // entry permission, so a caller holding only `admin:password:update` still reaches the form.
  const canEditRow = canUpdate || hasEffectivePermission(new Set(callerPermissions), ACTION_PERMISSIONS.setAdminPassword);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await listAdminsAccessSummary();
        if (cancelled || !result.success) return;
        const next: Record<number, AdminAccessSummary> = {};
        for (const row of result.data) next[row.adminId] = row;
        setAccessSummary(next);
      } catch (summaryFailure) {
        // Why: badges are supplementary; a failure here must not block the admin table.
        console.error('Failed to load admin access summary', summaryFailure);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [admins]);

  const runAction = useActionFeedback();

  const handleDelete = async (id: number) => {
    if (!(await confirm(destructiveConfirm('admin')))) return;
    const result = await runAction(
      { pending: 'Deleting admin...', success: 'Admin deleted', failure: 'Delete failed' },
      () => deleteAdmin(id)
    );
    if (result?.success) router.refresh();
  };

  const handleToggleEnabled = useCallback(async (admin: { id: number; enabled: boolean }): Promise<void> => {
    await runAction(
      {
        pending: admin.enabled ? 'Disabling admin...' : 'Enabling admin...',
        success: admin.enabled ? 'Admin disabled' : 'Admin enabled',
        failure: 'Failed to update admin',
      },
      () => updateAdmin(admin.id, { enabled: !admin.enabled })
    );
    router.refresh();
  }, [runAction, router]);

  const startEdit = (admin: AdminWithLogin) => {
    setEditingAdmin(admin);
    setIsModalOpen(true);
  };

  const handleClose = () => {
    setIsModalOpen(false);
    setEditingAdmin(null);
  };

  // Why published from here: the create button opens this panel's one AdminModal, so a copy of
  // it in the header would be a second modal holding its own open state over the same list.
  usePublishModuleActions(
    'administration.admins',
    capabilities.canCreate ? (
      <Button variant="positive" icon={Plus} onClick={() => { setEditingAdmin(null); setIsModalOpen(true); }}>
        {dict.admins.addAdmin}
      </Button>
    ) : null,
  );

  const applySort = (next: ListSortInput): void => {
    const params = new URLSearchParams(window.location.search);
    if (next !== null && next !== undefined) {
      params.set('sort', next.key);
      params.set('dir', next.direction);
    } else {
      params.delete('sort');
      params.delete('dir');
    }
    const query = params.toString();
    router.replace(query.length > 0 ? `?${query}` : window.location.pathname);
  };

  const columns = useMemo<ResponsiveColumn<AdminWithLogin>[]>(() => [
    {
      key: 'id',
      header: 'ID',
      sortKey: 'id',
      hideOnMobile: true,
      render: (admin) => <span className="font-mono text-muted-foreground text-xs">#{admin.id}</span>,
    },
    {
      key: 'username',
      header: 'Username',
      sortKey: 'username',
      render: (admin) => <span className="font-mono text-indigo-400 text-sm">{admin.username}</span>,
    },
    {
      key: 'name',
      header: 'Name',
      sortKey: 'name',
      render: (admin) => <span className="font-medium text-foreground">{admin.name}</span>,
    },
    {
      key: 'lastLogin',
      header: 'Last Login',
      sortKey: 'last_login_at',
      hideOnMobile: true,
      render: (admin) => (
        <span className="text-xs text-muted-foreground">
          {admin.last_login_at ? formatTimestamp(admin.last_login_at) : '—'}
        </span>
      ),
    },
    {
      key: 'groups',
      header: 'Groups',
      render: (admin) => {
        const groupNames = accessSummary[admin.id]?.groupNames ?? [];
        const overrideCount = accessSummary[admin.id]?.overrideCount ?? 0;
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            {groupNames.map((groupName) => (
              <span key={groupName} className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-400">
                {groupName}
              </span>
            ))}
            {accessSummary[admin.id] && groupNames.length === 0 && (
              <span className="text-xs text-muted-foreground italic">No groups</span>
            )}
            {overrideCount > 0 && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-warning/20 text-warning high-contrast:bg-warning high-contrast:text-warning-foreground"
                title={`${overrideCount} per-person override${overrideCount === 1 ? '' : 's'}`}
              >
                <ShieldAlert className="w-3 h-3" />
                {overrideCount}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'enabled',
      render: (admin) => {
        const badge = <span className={cn('px-2 py-0.5 text-xs rounded-full', admin.enabled ? 'bg-success/20 text-success high-contrast:bg-success high-contrast:text-success-foreground' : 'bg-destructive/20 text-destructive high-contrast:bg-destructive high-contrast:text-destructive-foreground')}>{admin.enabled ? 'Enabled' : 'Disabled'}</span>;
        if (!canUpdate) return badge;
        return (
          <Button variant="ghost" size="sm" onClick={() => handleToggleEnabled(admin)} className="h-auto p-1">
            {badge}
          </Button>
        );
      },
    },
  ], [accessSummary, canUpdate, formatTimestamp, handleToggleEnabled]);

  const table = (
    <ResponsiveTable
      columns={columns}
      rows={admins}
      getRowKey={(admin) => admin.id}
      getRowProps={(admin) => ({
        'data-shortcut-row': admin.id,
        className: cn('cursor-pointer transition-colors hover:bg-muted/50'),
        tabIndex: 0,
        onClick: () => { if (canEditRow) startEdit(admin); },
        onKeyDown: (event) => {
          if (event.key === 'Enter' && event.target === event.currentTarget && canEditRow) startEdit(admin);
        },
      })}
      renderRowActions={(admin) => (
        <AdminRowActions
          permissionKeys={callerPermissions}
          editLabel={actionLabels.edit}
          deleteLabel={actionLabels.delete}
          onEdit={() => startEdit(admin)}
          onDelete={() => { void handleDelete(admin.id); }}
        />
      )}
      sort={initialSort}
      onSortChange={applySort}
      emptyState={<EmptyState icon={ShieldCheck} title="No administrators found." />}
    />
  );

  return (
    <div className="space-y-6">
      {table}

      <AdminModal
        isOpen={isModalOpen}
        onClose={handleClose}
        initialData={editingAdmin}
        callerPermissions={callerPermissions}
        canRevealPassword={capabilities.canRevealPassword}
        onSuccess={() => router.refresh()}
      />
    </div>
  );
}
