'use client';

import { useEffect, useState } from 'react';

import { getAvailableContests } from '@/app/actions/contests';
import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { InlineAlert } from '@/components/core/InlineAlert';
import { TargetMultiSelect } from '@/components/core/TargetMultiSelect';
import { useDictionary } from '@/hooks/useDictionary';
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
 * Add the checked tasks to one or more contests through the batch endpoint,
 * which hands each task the next free number in each contest so a bulk add
 * cannot collide on the (contest_id, num) index.
 *
 * The contest list itself is the shared TargetMultiSelect — the same rows, search and select-all
 * the apply-limits dialog uses — so the two screens cannot drift apart.
 */
export function TaskBulkAssignDialog({ isOpen, onClose, taskIds, onSuccess }: TaskBulkAssignDialogProps): React.JSX.Element {
  const copy = useDictionary().limits.apply;
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

  const toggle = (id: number, checked: boolean): void => {
    setSelectedIds((current) => (checked ? [...new Set([...current, id])] : current.filter((value) => value !== id)));
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
          <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-muted-foreground">{copy.contests}</label>
          <TargetMultiSelect
            options={contests.map((contest) => ({ id: contest.id, label: contest.name }))}
            selectedIds={new Set(selectedIds)}
            onToggle={toggle}
            onSelectAll={(checked) => setSelectedIds(checked ? contests.map((contest) => contest.id) : [])}
            onClear={() => setSelectedIds([])}
            copy={copy}
            label={copy.searchContests}
          />
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
