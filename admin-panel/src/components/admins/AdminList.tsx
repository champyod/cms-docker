'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useSyncedState } from '@/hooks/useSyncedState';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';
import { Button } from '@/components/core/Button';
import { Badge } from '@/components/core/Badge';
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
import { countLabel } from '@/lib/format-number';
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
  // Why the hook and not window.location.pathname: it hands back the path with the base path stripped.
  const pathname = usePathname();
  const confirm = useConfirm();
  // An admin account outlives every contest, so its sign-in time reads in the operator's zone.
  const formatTimestamp = useFormatTimestamp();
  const { destructiveConfirm } = useConfirmationCopy();
  const canUpdate = hasEffectivePermission(new Set(callerPermissions), ACTION_PERMISSIONS.updateAdmin);
  // Both the Actions column and the row click admit either entry permission.
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

  // The create button opens this panel's one AdminModal; a header copy would hold a second open state.
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
    router.replace(query.length > 0 ? `?${query}` : pathname);
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
      render: (admin) => <span className="font-mono text-foreground text-sm">{admin.username}</span>,
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
          {admin.last_login_at ? formatTimestamp(admin.last_login_at) : dict.common.notSet}
        </span>
      ),
    },
    {
      key: 'groups',
      header: dict.admins.columns.groups,
      render: (admin) => {
        const groupNames = accessSummary[admin.id]?.groupNames ?? [];
        const overrideCount = accessSummary[admin.id]?.overrideCount ?? 0;
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            {groupNames.map((groupName) => (
              <Badge key={groupName} variant="indigo">
                {groupName}
              </Badge>
            ))}
            {accessSummary[admin.id] && groupNames.length === 0 && (
              <span className="text-xs text-muted-foreground italic">{dict.admins.noGroups}</span>
            )}
            {overrideCount > 0 && (
              <Badge
                variant="warning"
                className="gap-1"
                title={countLabel(overrideCount, dict.admins.overrides)}
              >
                <ShieldAlert className="w-3 h-3" />
                {overrideCount}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: dict.admins.columns.status,
      sortKey: 'enabled',
      render: (admin) => {
        const badge = (
          <Badge variant={admin.enabled ? 'success' : 'destructive'}>
            {admin.enabled ? dict.admins.enabled : dict.admins.disabled}
          </Badge>
        );
        if (!canUpdate) return badge;
        return (
          <Button variant="ghost" size="sm" onClick={() => handleToggleEnabled(admin)} className="h-auto p-1">
            {badge}
          </Button>
        );
      },
    },
  ], [accessSummary, canUpdate, dict.admins, formatTimestamp, handleToggleEnabled]);

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
