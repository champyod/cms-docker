'use client';

import { useState, useEffect } from 'react';
import { X, Users, UsersRound } from 'lucide-react';
import { Portal } from '../core/Portal';
import { addTeamToContest } from '@/app/actions/participations';
import { teams } from '@prisma/client';

interface TeamBulkAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  contestId: number;
  teams: teams[];
  onSuccess: () => void;
}

export function TeamBulkAddModal({ 
  isOpen, 
  onClose, 
  contestId, 
  teams: availableTeams,
  onSuccess 
}: TeamBulkAddModalProps) {
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);
  const [unrestricted, setUnrestricted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeamId) {
      setError('Please select a team');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const result = await addTeamToContest(contestId, selectedTeamId, { hidden, unrestricted });

      if (result.success) {
        onSuccess();
        onClose();
        setSelectedTeamId(null);
        setHidden(false);
        setUnrestricted(false);
      } else {
        setError(result.error || 'Failed to add team');
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="relative z-10 w-full max-w-md mx-4 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <UsersRound className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white">Add Team to Contest</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5 text-neutral-400" />
          </button>
        </div>
        
        {error && (
          <div className="mx-4 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Select Team</label>
            <select
              value={selectedTeamId ?? ''}
              onChange={(e) => setSelectedTeamId(e.target.value ? parseInt(e.target.value) : null)}
              className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
              required
            >
              <option value="">Choose a team...</option>
              {availableTeams.map(team => (
                <option key={team.id} value={team.id}>{team.name} ({team.code})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center gap-3 p-3 bg-black/30 rounded-lg cursor-pointer hover:bg-black/50 transition-colors">
              <input
                type="checkbox"
                checked={hidden}
                onChange={(e) => setHidden(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <div>
                <div className="text-sm font-medium text-white">Hidden</div>
                <div className="text-xs text-neutral-500">Hide from ranking</div>
              </div>
            </label>
            
            <label className="flex items-center gap-3 p-3 bg-black/30 rounded-lg cursor-pointer hover:bg-black/50 transition-colors">
              <input
                type="checkbox"
                checked={unrestricted}
                onChange={(e) => setUnrestricted(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <div>
                <div className="text-sm font-medium text-white">Unrestricted</div>
                <div className="text-xs text-neutral-500">Bypass limits</div>
              </div>
            </label>
          </div>

          <p className="text-xs text-neutral-500">
            This will add all users who have participated with this team in other contests to this contest.
          </p>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !selectedTeamId}
              className="flex-1 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Add Team'}
            </button>
          </div>
        </form>
      </div>
    </div>
    </Portal>
  );
}
