'use client';

import { useEffect, useState } from 'react';

import { getAvailableContests } from '@/app/actions/contests';
import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { InlineAlert } from '@/components/core/InlineAlert';
import { apiClient } from '@/lib/apiClient';
import { cn } from '@/lib/utils';

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
 * Add the checked tasks to one or more contests through the batch endpoint,
 * which hands each task the next free number in each contest so a bulk add
 * cannot collide on the (contest_id, num) index.
 */
export function TaskBulkAssignDialog({ isOpen, onClose, taskIds, onSuccess }: TaskBulkAssignDialogProps): React.JSX.Element {
  const [contests, setContests] = useState<ContestOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
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

  const toggle = (id: number): void => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  };

  const handleAssign = async (): Promise<void> => {
    if (selectedIds.length === 0) {
      setError('Choose at least one contest');
      return;
    }
    setLoading(true);
    setError('');
    const result = await apiClient.post('/api/tasks/batch', { action: 'assign', taskIds, contestIds: selectedIds });
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
      title={`Assign ${count} task${count === 1 ? '' : 's'} to contests`}
      className="sm:max-w-md"
      pending={loading}
    >
      {error && <InlineAlert tone="destructive" density="regular" className="mb-4">{error}</InlineAlert>}
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-muted-foreground">Contests</label>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {contests.length === 0 ? (
              <p className="py-3 text-center text-sm text-muted-foreground">No contests available</p>
            ) : (
              contests.map((contest) => {
                const active = selectedIds.includes(contest.id);
                return (
                  <button
                    key={contest.id}
                    type="button"
                    onClick={() => toggle(contest.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                      active ? 'border-ring/50 bg-primary/10 text-foreground' : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/50'
                    )}
                  >
                    <div className={cn('flex h-4 w-4 items-center justify-center rounded border', active ? 'border-primary bg-primary' : 'border-muted-foreground/40')}>
                      {active && <div className="h-2 w-2 rounded-sm bg-card" />}
                    </div>
                    <span className="text-sm">{contest.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button type="button" variant="positive" loading={loading} disabled={loading || selectedIds.length === 0} onClick={() => { void handleAssign(); }}>
            {loading ? 'Assigning...' : 'Assign'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
