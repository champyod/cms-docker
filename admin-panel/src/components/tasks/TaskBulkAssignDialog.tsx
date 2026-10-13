'use client';

import { useEffect, useState } from 'react';

import { getAvailableContests } from '@/app/actions/contests';
import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { InlineAlert } from '@/components/core/InlineAlert';
import { apiClient } from '@/lib/apiClient';

interface ContestOption {
  id: number;
  name: string;
  is_active: boolean;
}

interface TaskBulkAssignDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly taskIds: readonly number[];
  readonly onSuccess: () => void;
}

/**
 * Assign the checked tasks to one contest through the num-aware batch endpoint,
 * which hands each task the next free number so a bulk add cannot collide on
 * the (contest_id, num) index.
 */
export function TaskBulkAssignDialog({ isOpen, onClose, taskIds, onSuccess }: TaskBulkAssignDialogProps): React.JSX.Element {
  const [contests, setContests] = useState<ContestOption[]>([]);
  const [contestId, setContestId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    void (async () => {
      try {
        const result = await getAvailableContests();
        if (!active) return;
        if (result.success) {
          setContests(result.contests);
          setError('');
        } else {
          setError(result.error ?? 'Failed to load contests');
        }
      } catch {
        if (active) setError('Failed to load contests');
      }
    })();
    return () => {
      active = false;
    };
  }, [isOpen]);

  const handleAssign = async (): Promise<void> => {
    if (contestId === null) {
      setError('Choose a contest');
      return;
    }
    setLoading(true);
    setError('');
    const result = await apiClient.post('/api/tasks/batch', { action: 'assign', taskIds, contestId });
    setLoading(false);
    if (result.success) {
      onSuccess();
      onClose();
    } else {
      setError(result.error ?? 'Failed to assign tasks');
    }
  };

  const count = taskIds.length;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={`Assign ${count} task${count === 1 ? '' : 's'} to a contest`}
      className="sm:max-w-md"
      pending={loading}
    >
      {error && <InlineAlert tone="destructive" density="regular" className="mb-4">{error}</InlineAlert>}
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-muted-foreground">Contest</label>
          <select
            value={contestId ?? ''}
            onChange={(event) => setContestId(event.target.value ? Number(event.target.value) : null)}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="">Choose a contest...</option>
            {contests.map((contest) => (
              <option key={contest.id} value={contest.id}>{contest.name}</option>
            ))}
          </select>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button type="button" variant="positive" loading={loading} disabled={loading || contestId === null} onClick={() => { void handleAssign(); }}>
            {loading ? 'Assigning...' : 'Assign'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
