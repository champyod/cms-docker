'use client';

import { useState } from 'react';
import { addTeamToContest } from '@/app/actions/participations';
import { Dialog } from '@/components/core/Dialog';
import { Button } from '@/components/core/Button';

interface AvailableTeam {
  id: number;
  name: string;
  code: string;
}

interface TeamBulkAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  contestId: number;
  teams: AvailableTeam[];
  onSuccess: () => void;
}

export function TeamBulkAddModal({ isOpen, onClose, contestId, teams: availableTeams, onSuccess }: TeamBulkAddModalProps) {
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);
  const [unrestricted, setUnrestricted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }} title="Add Team to Contest" className="sm:max-w-md">
      {error && <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-muted-foreground">Select Team</label>
          <select
            value={selectedTeamId ?? ''}
            onChange={(e) => setSelectedTeamId(e.target.value ? parseInt(e.target.value) : null)}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            required
          >
            <option value="">Choose a team...</option>
            {availableTeams.map((team) => (
              <option key={team.id} value={team.id}>{team.name} ({team.code})</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-muted/30 p-3 transition-colors hover:bg-muted/50">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            <div>
              <div className="text-sm font-medium text-foreground">Hidden</div>
              <div className="text-xs text-muted-foreground">Hide from ranking</div>
            </div>
          </label>

          <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-muted/30 p-3 transition-colors hover:bg-muted/50">
            <input
              type="checkbox"
              checked={unrestricted}
              onChange={(e) => setUnrestricted(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            <div>
              <div className="text-sm font-medium text-foreground">Unrestricted</div>
              <div className="text-xs text-muted-foreground">Bypass limits</div>
            </div>
          </label>
        </div>

        <p className="text-xs text-muted-foreground">
          This will add all users who have participated with this team in other contests to this contest.
        </p>

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="positive" className="flex-1" loading={loading} disabled={loading || !selectedTeamId}>{loading ? 'Adding...' : 'Add Team'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
