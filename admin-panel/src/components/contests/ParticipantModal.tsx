'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { addParticipant } from '@/app/actions/contests';
import { Dialog } from '@/components/core/Dialog';
import { Button } from '@/components/core/Button';

interface AvailableUser {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
}

interface ParticipantModalProps {
  isOpen: boolean;
  onClose: () => void;
  contestId: number;
  availableUsers: AvailableUser[];
  onSuccess: () => void;
}

export function ParticipantModal({ isOpen, onClose, contestId, availableUsers }: ParticipantModalProps) {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<number | null>(null);

  const filteredUsers = availableUsers.filter((user) =>
    user.username.toLowerCase().includes(search.toLowerCase()) ||
    user.first_name.toLowerCase().includes(search.toLowerCase()) ||
    user.last_name.toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd = async (userId: number) => {
    setAdding(userId);
    try {
      await addParticipant(contestId, userId);
      window.location.reload();
    } catch (error) {
      console.error('Failed to add participant:', error);
    } finally {
      setAdding(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }} title="Add Participant" className="sm:max-w-md">
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search users..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-border bg-muted/50 py-2 pl-10 pr-4 text-sm text-foreground focus:border-primary/50 focus:outline-none"
        />
      </div>

      <div className="max-h-64 space-y-2 overflow-y-auto">
        {filteredUsers.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No users available</p>
        ) : (
          filteredUsers.map((user) => (
            <div key={user.id} className="flex items-center justify-between rounded-lg bg-muted/30 p-3 transition-colors hover:bg-muted/50">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {user.username.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{user.username}</div>
                  <div className="text-xs text-muted-foreground">{user.first_name} {user.last_name}</div>
                </div>
              </div>
              <Button size="sm" variant="positive" loading={adding === user.id} disabled={adding === user.id} onClick={() => handleAdd(user.id)}>Add</Button>
            </div>
          ))
        )}
      </div>
    </Dialog>
  );
}
