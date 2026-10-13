'use client';

import { useState } from 'react';

import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { InlineAlert } from '@/components/core/InlineAlert';
import { apiClient } from '@/lib/apiClient';
import type { ContestData } from '@/lib/contests-repo';
import { toZoneInstants } from '../contest-modal/contestFormMappers';

type SwitchState = 'unchanged' | 'on' | 'off';

interface SwitchSelectProps {
  readonly label: string;
  readonly value: SwitchState;
  readonly onChange: (value: SwitchState) => void;
}

function SwitchSelect({ label, value, onChange }: SwitchSelectProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as SwitchState)}
        className="rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <option value="unchanged">Unchanged</option>
        <option value="on">Enabled</option>
        <option value="off">Disabled</option>
      </select>
    </div>
  );
}

interface ContestBulkEditDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly contestIds: readonly number[];
  readonly onSuccess: () => void;
}

/**
 * Set the window fields selected contests share: start, stop, timezone and the
 * registration / IP switches. Each field is opt-in, so a bulk edit changes only
 * what the operator filled in and leaves the rest of every contest alone.
 */
export function ContestBulkEditDialog({ isOpen, onClose, contestIds, onSuccess }: ContestBulkEditDialogProps): React.JSX.Element {
  const [timezone, setTimezone] = useState('');
  const [changeStart, setChangeStart] = useState(false);
  const [start, setStart] = useState('');
  const [changeStop, setChangeStop] = useState(false);
  const [stop, setStop] = useState('');
  const [registration, setRegistration] = useState<SwitchState>('unchanged');
  const [ipRestriction, setIpRestriction] = useState<SwitchState>('unchanged');
  const [ipAutologin, setIpAutologin] = useState<SwitchState>('unchanged');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const buildPatch = (): Partial<ContestData> | null => {
    const patch: Partial<ContestData> = {};
    if (timezone.trim() !== '') patch.timezone = timezone.trim();
    if (changeStart && start !== '') patch.start = start;
    if (changeStop && stop !== '') patch.stop = stop;
    if (registration !== 'unchanged') patch.allow_registration = registration === 'on';
    if (ipRestriction !== 'unchanged') patch.ip_restriction = ipRestriction === 'on';
    if (ipAutologin !== 'unchanged') patch.ip_autologin = ipAutologin === 'on';

    if (Object.keys(patch).length === 0) return null;
    // Why the zone is required with a wall clock: start and stop are stored as
    // instants, so a typed wall clock names one only once the zone is known.
    if ((patch.start !== undefined || patch.stop !== undefined) && patch.timezone === undefined) return null;

    return toZoneInstants(patch, patch.timezone ?? 'UTC');
  };

  const handleApply = async (): Promise<void> => {
    const patch = buildPatch();
    if (patch === null) {
      setError('Choose at least one field; a changed start or stop also needs a timezone.');
      return;
    }
    setLoading(true);
    setError('');
    const result = await apiClient.post('/api/contests/batch', { action: 'update-window', contestIds, patch });
    setLoading(false);
    if (result.success) {
      onSuccess();
      onClose();
    } else {
      setError(result.error ?? 'Failed to update contests');
    }
  };

  const count = contestIds.length;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={`Edit window of ${count} contest${count === 1 ? '' : 's'}`}
      className="sm:max-w-lg"
      pending={loading}
    >
      {error && <InlineAlert tone="destructive" density="regular" className="mb-4">{error}</InlineAlert>}
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-widest text-muted-foreground">Timezone</label>
          <input
            type="text"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            placeholder="Asia/Bangkok"
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <input type="checkbox" checked={changeStart} onChange={(event) => setChangeStart(event.target.checked)} className="size-4 accent-primary" />
              Start time
            </label>
            <input
              type="datetime-local"
              value={start}
              disabled={!changeStart}
              onChange={(event) => setStart(event.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            />
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <input type="checkbox" checked={changeStop} onChange={(event) => setChangeStop(event.target.checked)} className="size-4 accent-primary" />
              Stop time
            </label>
            <input
              type="datetime-local"
              value={stop}
              disabled={!changeStop}
              onChange={(event) => setStop(event.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            />
          </div>
        </div>

        <SwitchSelect label="Public registration" value={registration} onChange={setRegistration} />
        <SwitchSelect label="IP restriction" value={ipRestriction} onChange={setIpRestriction} />
        <SwitchSelect label="IP auto-login" value={ipAutologin} onChange={setIpAutologin} />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button type="button" variant="positive" loading={loading} disabled={loading} onClick={() => { void handleApply(); }}>
            {loading ? 'Applying...' : 'Apply to selected'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
