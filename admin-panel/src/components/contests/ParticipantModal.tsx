'use client';

import { useState, useEffect } from 'react';
import { users } from '@prisma/client';
import { X, UserPlus, Search } from 'lucide-react';
import { addParticipant } from '@/app/actions/contests';

interface ParticipantModalProps {
  isOpen: boolean;
  onClose: () => void;
  contestId: number;
  availableUsers: users[];
  onSuccess?: () => void;
}

export function ParticipantModal({ isOpen, onClose, contestId, availableUsers, onSuccess }: ParticipantModalProps) {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredUsers = availableUsers.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.first_name.toLowerCase().includes(search.toLowerCase()) ||
    u.last_name.toLowerCase().includes(search.toLowerCase())
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative z-10 w-full max-w-md mx-4 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white">Add Participant</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5 text-neutral-400" />
          </button>
        </div>
        
        <div className="p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
            <input
              type="text"
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          
          <div className="max-h-64 overflow-y-auto space-y-2">
            {filteredUsers.length === 0 ? (
              <p className="text-neutral-500 text-sm text-center py-4">No users available</p>
            ) : (
              filteredUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-3 bg-black/30 rounded-lg hover:bg-black/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-indigo-600/20 flex items-center justify-center text-indigo-400 font-bold text-sm">
                      {user.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white">{user.username}</div>
                      <div className="text-xs text-neutral-500">
                        {user.first_name} {user.last_name}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleAdd(user.id)}
                    disabled={adding === user.id}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
                  >
                    {adding === user.id ? 'Adding...' : 'Add'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
