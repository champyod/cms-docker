'use client';

import { useDroppable } from '@dnd-kit/core';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SUBTASK_POOL_ZONE_ID, type SubtaskGroup } from './subtask-board';
import { SubtaskChip } from './SubtaskChip';

interface SubtaskGroupCardProps {
  group: SubtaskGroup;
  scoreType: string;
  canRemove: boolean;
  otherGroups: readonly SubtaskGroup[];
  onUpdate: (patch: Partial<SubtaskGroup>) => void;
  onRemove: () => void;
  onMoveTestcase: (codename: string, targetGroupId: string | null) => void;
}

const FIELD_CLASSES = 'w-full px-2.5 py-1.5 bg-muted/40 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/50';

export function SubtaskGroupCard({ group, scoreType, canRemove, otherGroups, onUpdate, onRemove, onMoveTestcase }: SubtaskGroupCardProps): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: group.id });
  return (
    <div ref={setNodeRef} className={cn('flex flex-col gap-2 rounded-xl border p-3 transition-colors', isOver ? 'border-ring bg-ring/10' : 'border-border bg-muted/20')}>
      <GroupHeader group={group} canRemove={canRemove} onRemove={onRemove} />
      <GroupFields group={group} scoreType={scoreType} onUpdate={onUpdate} />
      <GroupTestcases group={group} otherGroups={otherGroups} onMoveTestcase={onMoveTestcase} />
    </div>
  );
}

function GroupHeader({ group, canRemove, onRemove }: { group: SubtaskGroup; canRemove: boolean; onRemove: () => void }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold text-foreground">{group.name}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={`Remove ${group.name}`}
        className="ml-auto flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-30"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function GroupFields({ group, scoreType, onUpdate }: { group: SubtaskGroup; scoreType: string; onUpdate: (patch: Partial<SubtaskGroup>) => void }): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Max score</label>
        <input
          type="number"
          min="0"
          step="any"
          value={group.maxScore}
          onChange={(e) => onUpdate({ maxScore: e.target.value })}
          placeholder="e.g. 40"
          aria-label={`${group.name} max score`}
          className={FIELD_CLASSES}
        />
      </div>
      {scoreType === 'GroupThreshold' && (
        <div>
          <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Threshold</label>
          <input
            type="number"
            min="0"
            max="1"
            step="any"
            value={group.threshold}
            onChange={(e) => onUpdate({ threshold: e.target.value })}
            aria-label={`${group.name} threshold`}
            className={FIELD_CLASSES}
          />
        </div>
      )}
    </div>
  );
}

function GroupTestcases({ group, otherGroups, onMoveTestcase }: { group: SubtaskGroup; otherGroups: readonly SubtaskGroup[]; onMoveTestcase: (codename: string, targetGroupId: string | null) => void }): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      {group.testcases.length === 0 && (
        <span className="text-xs text-muted-foreground">Drop testcases here</span>
      )}
      {group.testcases.map((codename) => (
        <div key={codename} className="flex items-center gap-1.5">
          <SubtaskChip codename={codename} />
          <select
            value=""
            onChange={(e) => {
              const value = e.target.value;
              if (value === '') return;
              onMoveTestcase(codename, value === SUBTASK_POOL_ZONE_ID ? null : value);
            }}
            aria-label={`Move ${codename} to another subtask`}
            className="min-w-0 flex-1 px-1.5 py-0.5 text-xs bg-muted/40 border border-border rounded-md text-foreground focus:outline-none focus:border-ring"
          >
            <option value="">Move to…</option>
            <option value={SUBTASK_POOL_ZONE_ID}>Unassigned</option>
            {otherGroups.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
