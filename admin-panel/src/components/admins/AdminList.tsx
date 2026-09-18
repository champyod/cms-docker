'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useSyncedState } from '@/hooks/useSyncedState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { MobileCard, MobileCardRow } from '@/components/core/MobileCard';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { updateAdmin, deleteAdmin } from '@/app/actions/admins';
import { listAdminsAccessSummary, type AdminAccessSummary } from '@/app/actions/adminPermissions';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { AdminModal } from './AdminModal';
import {
  AdminPanelCard,
  AdminRowActions,
  hasAdminControl,
  type AdminCapabilities,
  type AdminPanelLabels,
} from './AdminPanelCard';
import type { AdminWithLogin } from '@/lib/prisma-selects';

interface AdminListProps {
  initialAdmins: AdminWithLogin[];
  callerPermissions: string[];
  capabilities: AdminCapabilities;
  actionLabels: { edit: string; delete: string };
  panelLabels: AdminPanelLabels;
}

export function AdminList({
  initialAdmins,
  callerPermissions,
  capabilities,
  actionLabels,
  panelLabels,
}: AdminListProps) {
  const [adminsList] = useSyncedState(initialAdmins);
  const [accessSummary, setAccessSummary] = useState<Record<number, AdminAccessSummary>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminWithLogin | null>(null);
  const router = useRouter();
  const confirm = useConfirm();
  const { destructiveConfirm } = useConfirmationCopy();

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
  }, [adminsList]);

  const handleDelete = async (id: number) => {
    if (!(await confirm(destructiveConfirm('admin')))) return;
    const result = await deleteAdmin(id);
    if (result.success) {
      router.refresh();
    } else {
      toast.error(result.error);
    }
  };

  const handleToggleEnabled = async (admin: { id: number; enabled: boolean }) => {
    const result = await updateAdmin(admin.id, { enabled: !admin.enabled });
    if (!result.success) {
      toast.error(result.error ?? 'Failed to update admin');
    }
    router.refresh();
  };

  const startEdit = (admin: AdminWithLogin) => {
    setEditingAdmin(admin);
    setIsModalOpen(true);
  };

  const handleClose = () => {
    setIsModalOpen(false);
    setEditingAdmin(null);
  };

  const startCreate = () => {
    setEditingAdmin(null);
    setIsModalOpen(true);
  };

  // Why: the Edit/Delete pair is control surface, so a caller holding none of those keys gets no Actions column.
  const showRowActions = capabilities.canUpdate || capabilities.canSetPassword || capabilities.canDelete;
  const columnCount = showRowActions ? 7 : 6;

  const renderStatusToggle = (admin: AdminWithLogin) => {
    const badge = admin.enabled ? (
      <span className="px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded-full">Enabled</span>
    ) : (
      <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded-full">Disabled</span>
    );
    if (!capabilities.canUpdate) return badge;
    return (
      <Button variant="ghost" size="sm" onClick={() => handleToggleEnabled(admin)} className="h-auto p-1">
        {badge}
      </Button>
    );
  };

  const table = (
    <div className="border border-border rounded-xl overflow-hidden bg-card/50">
      <Table
        mobileCards={adminsList.map((admin) => {
          const names = accessSummary[admin.id]?.groupNames ?? [];
          const count = accessSummary[admin.id]?.overrideCount ?? 0;
          const permLabel = names.length > 0 ? names.join(', ') + (count > 0 ? ` (+${count} override${count === 1 ? '' : 's'})` : '') : '—';
          return (
            <MobileCard key={admin.id}>
              <MobileCardRow label="Username" value={admin.username} />
              <MobileCardRow label="Name" value={admin.name} />
              <MobileCardRow label="Groups" value={permLabel} />
              <MobileCardRow label="Status" value={admin.enabled ? 'Enabled' : 'Disabled'} />
              <AdminRowActions
                capabilities={capabilities}
                editLabel={actionLabels.edit}
                deleteLabel={actionLabels.delete}
                onEdit={() => startEdit(admin)}
                onDelete={() => { void handleDelete(admin.id); }}
                className="pt-2"
              />
            </MobileCard>
          );
        })}
      >
        <TableHeader>
          <TableRow className="border-b border-border">
            <TableHead className="text-muted-foreground">ID</TableHead>
            <TableHead className="text-muted-foreground">Username</TableHead>
            <TableHead className="text-muted-foreground">Name</TableHead>
            <TableHead className="text-muted-foreground">Last Login</TableHead>
            <TableHead className="text-muted-foreground">Groups</TableHead>
            <TableHead className="text-muted-foreground">Status</TableHead>
            {showRowActions && (
              <TableHead className="text-muted-foreground text-right">Actions</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {adminsList.map((admin) => {
            const groupNames = accessSummary[admin.id]?.groupNames ?? [];
            const overrideCount = accessSummary[admin.id]?.overrideCount ?? 0;
            return (
              <TableRow key={admin.id} data-shortcut-row={admin.id} className="border-b border-border hover:bg-muted/50 transition-colors">
                <TableCell className="font-mono text-muted-foreground text-xs">#{admin.id}</TableCell>
                <TableCell className="font-mono text-indigo-400 text-sm">{admin.username}</TableCell>
                <TableCell className="font-medium text-foreground">{admin.name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {admin.last_login_at ? new Date(admin.last_login_at).toLocaleString() : '—'}
                </TableCell>
                <TableCell>
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
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-400"
                        title={`${overrideCount} per-person override${overrideCount === 1 ? '' : 's'}`}
                      >
                        <ShieldAlert className="w-3 h-3" />
                        {overrideCount}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>{renderStatusToggle(admin)}</TableCell>
                {showRowActions && (
                  <TableCell className="text-right">
                    <AdminRowActions
                      capabilities={capabilities}
                      editLabel={actionLabels.edit}
                      deleteLabel={actionLabels.delete}
                      onEdit={() => startEdit(admin)}
                      onDelete={() => { void handleDelete(admin.id); }}
                    />
                  </TableCell>
                )}
              </TableRow>
            );
          })}
          {adminsList.length === 0 && (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-12">
                <EmptyState icon={ShieldCheck} title="No administrators found." />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="space-y-6">
      {hasAdminControl(capabilities) ? (
        <AdminPanelCard capabilities={capabilities} labels={panelLabels} onAdd={startCreate}>
          {table}
        </AdminPanelCard>
      ) : (
        table
      )}

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
