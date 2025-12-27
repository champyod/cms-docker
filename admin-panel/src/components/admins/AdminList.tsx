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
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    password: '',
    permission_all: false,
    permission_messaging: true,
  });

  const handleUpdate = async () => {
    if (!editingAdmin) return;
    const result = await updateAdmin(editingAdmin.id, {
      name: formData.name,
      permission_all: formData.permission_all,
      permission_messaging: formData.permission_messaging,
      ...(formData.password ? { password: formData.password } : {}),
    });
    if (result.success) {
      window.location.reload();
    } else {
      alert(result.error);
    }
  };

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
    setFormData({
      name: admin.name,
      username: admin.username,
      password: '',
      permission_all: admin.permission_all,
      permission_messaging: admin.permission_messaging,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-white">All Administrators</h2>
        <Button 
          variant="primary" 
          className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white pl-3 pr-4"
          onClick={() => setIsModalOpen(true)}
        >
          <Plus className="w-4 h-4" />
          Add Admin
        </Button>
      </div>

      {editingAdmin && (
        <div className="p-4 bg-black/30 rounded-lg space-y-4">
          <div className="text-white text-sm mb-4">Editing {editingAdmin.username}</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Username</label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                disabled={!!editingAdmin}
                className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm disabled:opacity-50"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">
              Password {editingAdmin && '(leave empty to keep current)'}
            </label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm"
            />
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={formData.permission_all}
                onChange={(e) => setFormData({ ...formData, permission_all: e.target.checked })}
                className="w-4 h-4 rounded"
              />
              Full Permissions
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={formData.permission_messaging}
                onChange={(e) => setFormData({ ...formData, permission_messaging: e.target.checked })}
                className="w-4 h-4 rounded"
              />
              Messaging
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleUpdate}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm"
            >
              Update
            </button>
            <button
              onClick={() => {
                setEditingAdmin(null);
                setFormData({ name: '', username: '', password: '', permission_all: false, permission_messaging: false });
              }}
              className="px-4 py-2 text-neutral-700 hover:bg-neutral-600 text-white rounded-lg text-sm bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => window.location.reload()}
      />
    </div>
  );
}
