'use client';

import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { Button } from '@/components/core/Button';
import { Edit2, Trash2, Plus, Shield, ShieldCheck } from 'lucide-react';
import { admins } from '@prisma/client';
import { updateAdmin, deleteAdmin } from '@/app/actions/admins';
import { AdminModal } from './AdminModal';

export function AdminList({ initialAdmins }: { initialAdmins: admins[] }) {
  const [adminsList] = useState(initialAdmins);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<admins | null>(null);

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

  const handleToggleEnabled = async (admin: admins) => {
    await updateAdmin(admin.id, { enabled: !admin.enabled });
    window.location.reload();
  };

  const startEdit = (admin: admins) => {
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
        <h2 className="text-xl font-bold text-white">All Administrators</h2>
        <Button 
          variant="primary" 
          className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white pl-3 pr-4"
          onClick={() => { setEditingAdmin(null); setIsModalOpen(true); }}
        >
          <Plus className="w-4 h-4" />
          Add Admin
        </Button>
      </div>

      <div className="border border-white/5 rounded-xl overflow-hidden bg-neutral-900/40">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-white/5 hover:bg-white/5">
              <TableHead className="text-neutral-400">ID</TableHead>
              <TableHead className="text-neutral-400">Username</TableHead>
              <TableHead className="text-neutral-400">Name</TableHead>
              <TableHead className="text-neutral-400">Permissions</TableHead>
              <TableHead className="text-neutral-400">Status</TableHead>
              <TableHead className="text-neutral-400 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {adminsList.map((admin) => (
              <TableRow key={admin.id} className="border-b border-white/5 hover:bg-white/5">
                <TableCell className="font-mono text-neutral-500 text-xs">#{admin.id}</TableCell>
                <TableCell className="font-mono text-indigo-400 text-sm">{admin.username}</TableCell>
                <TableCell className="font-medium text-white">{admin.name}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {admin.permission_all && (
                      <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded-full">Full</span>
                    )}
                    {admin.permission_messaging && (
                      <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded-full">Messaging</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <button onClick={() => handleToggleEnabled(admin)}>
                    {admin.enabled ? (
                      <span className="px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded-full">Enabled</span>
                    ) : (
                      <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded-full">Disabled</span>
                    )}
                  </button>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(admin)} className="h-8 w-8 p-0 text-neutral-400 hover:text-indigo-400">
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(admin.id)} className="h-8 w-8 p-0 text-neutral-400 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {adminsList.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-neutral-500">
                  No administrators found.
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
