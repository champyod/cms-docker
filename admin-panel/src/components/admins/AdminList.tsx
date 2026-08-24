'use client';

import { useState } from 'react';
import { useSyncedState } from '@/hooks/useSyncedState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { Edit2, Trash2, Plus, ShieldCheck } from 'lucide-react';
import { updateAdmin, deleteAdmin } from '@/app/actions/admins';
import { AdminModal } from './AdminModal';
import type { PermissionFlagKey } from './adminFormConfig';
import { cn } from '@/lib/utils';
import type { AdminWithLogin } from '@/lib/prisma-selects';

const PERMISSION_BADGES = [
  { key: 'permission_all', label: 'Full', className: 'bg-purple-500/20 text-purple-400' },
  { key: 'permission_messaging', label: 'Messaging', className: 'bg-blue-500/20 text-blue-400' },
  { key: 'permission_tasks', label: 'Tasks', className: 'bg-orange-500/20 text-orange-400' },
  { key: 'permission_users', label: 'Users', className: 'bg-teal-500/20 text-teal-400' },
  { key: 'permission_contests', label: 'Contests', className: 'bg-indigo-500/20 text-indigo-400' },
] as const satisfies ReadonlyArray<{ key: PermissionFlagKey; label: string; className: string }>;

interface AdminListProps {
  initialAdmins: AdminWithLogin[];
  actionLabels: { edit: string; delete: string };
}

export function AdminList({ initialAdmins, actionLabels }: AdminListProps) {
  const [adminsList] = useSyncedState(initialAdmins);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminWithLogin | null>(null);

  const handleDelete = async (id: number) => {
    if (confirm('Delete this admin?')) {
      const result = await deleteAdmin(id);
      if (result.success) {
        window.location.reload();
      } else {
        alert(result.error);
      }
    }
  };

  const handleToggleEnabled = async (admin: { id: number; enabled: boolean }) => {
    const result = await updateAdmin(admin.id, { enabled: !admin.enabled });
    if (!result.success) {
      alert(result.error ?? 'Failed to update admin');
    }
    window.location.reload();
  };

  const startEdit = (admin: AdminWithLogin) => {
    setEditingAdmin(admin);
    setIsModalOpen(true);
  };

  const handleClose = () => {
    setIsModalOpen(false);
    setEditingAdmin(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-foreground">All Administrators</h2>
        <Button
          variant="positive"
          onClick={() => { setEditingAdmin(null); setIsModalOpen(true); }}
        >
          <Plus className="w-4 h-4" />
          Add Admin
        </Button>
      </div>

      <div className="border border-border rounded-xl overflow-hidden bg-card/50">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border">
              <TableHead className="text-muted-foreground">ID</TableHead>
              <TableHead className="text-muted-foreground">Username</TableHead>
              <TableHead className="text-muted-foreground">Name</TableHead>
              <TableHead className="text-muted-foreground">Last Login</TableHead>
              <TableHead className="text-muted-foreground">Permissions</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-muted-foreground text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {adminsList.map((admin) => (
              <TableRow key={admin.id} data-shortcut-row={admin.id} className="border-b border-border hover:bg-muted/50 transition-colors">
                <TableCell className="font-mono text-muted-foreground text-xs">#{admin.id}</TableCell>
                <TableCell className="font-mono text-indigo-400 text-sm">{admin.username}</TableCell>
                <TableCell className="font-medium text-foreground">{admin.name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {admin.last_login_at ? new Date(admin.last_login_at).toLocaleString() : '—'}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {PERMISSION_BADGES.filter((badge) => admin[badge.key]).map((badge) => (
                      <span key={badge.key} className={cn('px-2 py-0.5 text-xs rounded-full', badge.className)}>
                        {badge.label}
                      </span>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={() => handleToggleEnabled(admin)} className="h-auto p-1">
                    {admin.enabled ? (
                      <span className="px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded-full">Enabled</span>
                    ) : (
                      <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded-full">Disabled</span>
                    )}
                  </Button>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      tooltip={actionLabels.edit}
                      onClick={() => startEdit(admin)}
                      className="text-muted-foreground hover:text-primary"
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      tooltip={actionLabels.delete}
                      onClick={() => handleDelete(admin.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {adminsList.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-12">
                  <EmptyState icon={ShieldCheck} title="No administrators found." />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AdminModal
        isOpen={isModalOpen}
        onClose={handleClose}
        initialData={editingAdmin}
        onSuccess={() => window.location.reload()}
      />
    </div>
  );
}
