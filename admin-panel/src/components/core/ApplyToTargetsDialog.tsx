'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { InlineAlert } from '@/components/core/InlineAlert';
import { LimitField } from '@/components/core/LimitField';
import { TargetMultiSelect, type TargetOption } from '@/components/core/TargetMultiSelect';
import { useDictionary } from '@/hooks/useDictionary';
import { apiClient } from '@/lib/apiClient';
import { LIMIT_FIELDS, type LimitFieldName } from '@/lib/limits';
import type { LimitPatch } from '@/lib/limit-patch';

export type TargetKind = 'contest' | 'task';

export interface ApplyToTargetsDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** The kinds this instance may target; one for a modal entry, one or both for a bulk bar. */
  readonly kinds: readonly TargetKind[];
  /**
   * The limit fields to edit and the values to seed them with. The keys are the fields the dialog
   * shows; a null seed is the "no limit" (∞) state the operator can leave or change.
   */
  readonly patch: Partial<Record<LimitFieldName, number | null>>;
  /** The ids the entry point already picked (a list's checked rows), per kind. */
  readonly preselected?: Partial<Record<TargetKind, readonly number[]>>;
  /** Loads the selectable targets for one kind; supplied by the entry point so core stays feature-free. */
  readonly loadTargets: (kind: TargetKind) => Promise<readonly TargetOption[]>;
  /** Refreshes the entry screen; fired whenever at least one target took the write. */
  readonly onSuccess?: () => void;
  /**
   * Whether the seeded values start already applied. A modal entry seeds the form and means "push
   * these", so its values count; a list bulk bar seeds an empty intent and means "edit limits", so
   * nothing is sent until the operator sets or clears a field.
   */
  readonly initiallyTouched?: boolean;
}

const BATCH_PATH: Record<TargetKind, string> = { contest: '/api/contests/batch', task: '/api/tasks/batch' };
const IDS_KEY: Record<TargetKind, 'contestIds' | 'taskIds'> = { contest: 'contestIds', task: 'taskIds' };
const LABEL_KEY: Record<TargetKind, 'contests' | 'tasks'> = { contest: 'contests', task: 'tasks' };
const SEARCH_LABEL_KEY: Record<TargetKind, 'searchContests' | 'searchTasks'> = { contest: 'searchContests', task: 'searchTasks' };

function formatCount(template: string, count: number): string {
  return template.replace('{count}', String(count));
}

function failedIdsOf(payload: unknown): number[] {
  const rows = (payload as { failed?: unknown })?.failed;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => Number((row as { id?: unknown })?.id)).filter((id) => Number.isInteger(id));
}

/**
 * The one "apply these limits to many contests / tasks" dialog.
 *
 * Why one: the operator picks the targets here — a searchable, select-all checkbox list over the
 * chosen kinds — and the limit patch they typed in the form (or made up for a bulk edit) is posted
 * to each kind's batch `update-limits` action. Every write travels through the same whitelisted
 * route and service as a single-record edit, so this dialog holds no write logic of its own.
 */
export function ApplyToTargetsDialog({
  isOpen,
  onClose,
  kinds,
  patch,
  preselected,
  loadTargets,
  onSuccess,
  initiallyTouched = true,
}: ApplyToTargetsDialogProps): React.JSX.Element {
  const dict = useDictionary();
  const copy = dict.limits.apply;
  const fields = useMemo(() => (Object.keys(patch) as LimitFieldName[]).filter((name) => LIMIT_FIELDS.includes(name)), [patch]);

  const [options, setOptions] = useState<Partial<Record<TargetKind, TargetOption[]>>>({});
  const [selected, setSelected] = useState<Partial<Record<TargetKind, number[]>>>({});
  const [values, setValues] = useState<Partial<Record<LimitFieldName, number | null>>>({});
  const [touched, setTouched] = useState<ReadonlySet<LimitFieldName>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Why the ref: the reset must run on the open transition only. Keying the effect on the patch /
  // kinds / preselected objects would re-run it — and wipe the operator's edits — on every parent
  // render, because those props are rebuilt each time.
  const initRef = useRef({ kinds, patch, preselected, loadTargets, initiallyTouched, fields });
  initRef.current = { kinds, patch, preselected, loadTargets, initiallyTouched, fields };

  useEffect(() => {
    if (!isOpen) return;
    const { kinds: kindsNow, patch: patchNow, preselected: preselectNow, loadTargets: load, initiallyTouched: seeded, fields: fieldsNow } = initRef.current;
    setError('');
    setNotice('');
    setLoading(false);
    setValues({ ...patchNow });
    setTouched(seeded ? new Set(fieldsNow) : new Set());
    setSelected(Object.fromEntries(kindsNow.map((kind) => [kind, [...(preselectNow?.[kind] ?? [])]])) as Partial<Record<TargetKind, number[]>>);

    let active = true;
    void (async () => {
      const loaded: Partial<Record<TargetKind, TargetOption[]>> = {};
      for (const kind of kindsNow) {
        try {
          loaded[kind] = [...(await load(kind))];
        } catch {
          loaded[kind] = [];
        }
      }
      if (active) setOptions(loaded);
    })();
    return () => {
      active = false;
    };
  }, [isOpen]);

  const toggle = (kind: TargetKind, id: number, checked: boolean): void => {
    setSelected((current) => {
      const ids = current[kind] ?? [];
      return { ...current, [kind]: checked ? [...new Set([...ids, id])] : ids.filter((value) => value !== id) };
    });
  };

  const selectAll = (kind: TargetKind, checked: boolean): void => {
    setSelected((current) => ({ ...current, [kind]: checked ? (options[kind] ?? []).map((option) => option.id) : [] }));
  };

  const clearKind = (kind: TargetKind): void => {
    setSelected((current) => ({ ...current, [kind]: [] }));
  };

  const setField = (name: LimitFieldName, next: number | null): void => {
    setValues((current) => ({ ...current, [name]: next }));
    setTouched((current) => new Set([...current, name]));
  };

  const totalSelected = kinds.reduce((sum, kind) => sum + (selected[kind]?.length ?? 0), 0);

  const handleApply = async (): Promise<void> => {
    if (totalSelected === 0) {
      setError(copy.needTarget);
      return;
    }
    const payloadPatch: LimitPatch = {};
    for (const name of fields) if (touched.has(name)) payloadPatch[name] = values[name] ?? null;
    if (Object.keys(payloadPatch).length === 0) {
      setError(copy.needField);
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');
    let updatedCount = 0;
    const failed: number[] = [];
    let refused = false;

    for (const kind of kinds) {
      const ids = selected[kind] ?? [];
      if (ids.length === 0) continue;
      const result = await apiClient.post(BATCH_PATH[kind], { action: 'update-limits', [IDS_KEY[kind]]: ids, patch: payloadPatch });
      if (result.success) {
        updatedCount += Number(result.updatedCount ?? 0);
        failed.push(...failedIdsOf(result));
      } else {
        refused = true;
        failed.push(...ids);
      }
    }
    setLoading(false);

    if (refused && updatedCount === 0) {
      setError(copy.failure);
      return;
    }
    if (updatedCount > 0) onSuccess?.();
    if (failed.length === 0) {
      onClose();
      return;
    }
    // Why the dialog stays open: the successes are real and already refreshed, so the operator is
    // told which targets refused instead of losing that half of the result behind a closing modal.
    setNotice(formatCount(copy.failed, updatedCount).replace('{ids}', failed.join(', ')));
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={copy.title}
      className="sm:max-w-lg"
      pending={loading}
    >
      {error !== '' && <InlineAlert tone="destructive" density="regular" className="mb-4">{error}</InlineAlert>}
      {notice !== '' && <InlineAlert tone="warning" density="regular" className="mb-4">{notice}</InlineAlert>}

      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map((name) => (
            <LimitField
              key={name}
              id={`apply-${name}`}
              label={dict.limits.fields[name]}
              hint={dict.limits.hints[name]}
              value={values[name] ?? null}
              onChangeValue={(next) => setField(name, next)}
              unlimitedLabel={dict.limits.unlimited}
            />
          ))}
        </div>

        {kinds.map((kind) => (
          <div key={kind} className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{copy[LABEL_KEY[kind]]}</p>
            <TargetMultiSelect
              options={options[kind] ?? []}
              selectedIds={new Set(selected[kind] ?? [])}
              onToggle={(id, checked) => toggle(kind, id, checked)}
              onSelectAll={(checked) => selectAll(kind, checked)}
              onClear={() => clearKind(kind)}
              copy={copy}
              label={copy[SEARCH_LABEL_KEY[kind]]}
            />
          </div>
        ))}

        <div className="flex items-center justify-between gap-3 pt-2">
          <span className="text-sm font-medium text-foreground" data-testid="apply-targets-count">
            {formatCount(copy.selectedCount, totalSelected)}
          </span>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
              {copy.cancel}
            </Button>
            <Button type="button" variant="positive" loading={loading} disabled={loading} onClick={() => { void handleApply(); }}>
              {formatCount(copy.applyTo, totalSelected)}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
