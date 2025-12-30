'use client';

import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { Button } from '@/components/core/Button';
import { Edit2, Trash2, Plus, HelpCircle } from 'lucide-react';
import Link from 'next/link';
import { UserModal } from './UserModal';
import { deleteUser } from '@/app/actions/users';

import { users } from '@prisma/client';

export function UserList({ initialUsers, totalPages }: { initialUsers: users[], totalPages: number }) {
  const [users] = useState(initialUsers); // Removed unused setUsers
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<users | null>(null);

  const handleEdit = (user: users) => {
    setSelectedUser(user);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to delete this user?')) {
      const result = await deleteUser(id);
      if (result.success) {
         // Optimistic update or refresh needed. 
         // Since we used revalidatePath in action, simpler here is to refresh.
         window.location.reload(); 
      } else {
        alert('Failed to delete user');
      }
    }
  };

  const handleCreate = () => {
    setSelectedUser(null);
    setIsModalOpen(true);
  };

  const handleSuccess = () => {
    window.location.reload();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-white">All Users</h2>
          <Link href="/en/docs#users" className="p-1 hover:bg-white/10 rounded-full transition-colors text-neutral-400 hover:text-white" title="View Documentation">
            <HelpCircle className="w-4 h-4" />
          </Link>
        </div>
        <Button 
            variant="primary" 
            className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white pl-3 pr-4"
            onClick={handleCreate}
        >
          <Plus className="w-4 h-4" />
          Create User
        </Button>
      </div>

      <div className="border border-white/5 rounded-xl overflow-hidden bg-neutral-900/40 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-white/5 hover:bg-white/5">
              <TableHead className="text-neutral-400">ID</TableHead>
              <TableHead className="text-neutral-400">Name</TableHead>
              <TableHead className="text-neutral-400">Username</TableHead>
              <TableHead className="text-neutral-400">Email</TableHead>
              <TableHead className="text-neutral-400 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <TableCell className="font-mono text-neutral-500 text-xs">#{user.id}</TableCell>
                <TableCell className="font-medium text-white">{user.first_name} {user.last_name}</TableCell>
                <TableCell className="text-neutral-300">{user.username}</TableCell>
                <TableCell className="text-neutral-400">{user.email || '-'}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
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
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
                <TableRow>
                    <TableCell colSpan={5} className="text-center py-12 text-neutral-500">
                        No users found.
                    </TableCell>
                </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      
      <UserModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        user={selectedUser}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
