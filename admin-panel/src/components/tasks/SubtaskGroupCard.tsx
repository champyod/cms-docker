'use client';

import { useDroppable } from '@dnd-kit/core';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';
import { Select } from '@/components/core/Select';
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

const MOVE_PLACEHOLDER = 'Move to…';

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
      <Button
        variant="ghost"
        iconOnly
        icon={Trash2}
        tooltip={`Remove ${group.name}`}
        aria-label={`Remove ${group.name}`}
        onClick={onRemove}
        disabled={!canRemove}
        className="ml-auto size-11 shrink-0 rounded-lg hover:text-destructive"
      />
    </div>
  );
}

function GroupFields({ group, scoreType, onUpdate }: { group: SubtaskGroup; scoreType: string; onUpdate: (patch: Partial<SubtaskGroup>) => void }): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input
        type="number"
        min={0}
        step="any"
        label="Max score"
        value={group.maxScore}
        onChange={(event) => onUpdate({ maxScore: event.target.value })}
        placeholder="e.g. 40"
        aria-label={`${group.name} max score`}
      />
      {scoreType === 'GroupThreshold' && (
        <Input
          type="number"
          min={0}
          max={1}
          step="any"
          label="Threshold"
          value={group.threshold}
          onChange={(event) => onUpdate({ threshold: event.target.value })}
          aria-label={`${group.name} threshold`}
        />
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
          <div className="min-w-0 flex-1">
            <Select
              value=""
              placeholder={MOVE_PLACEHOLDER}
              onChange={(event) => {
                const value = event.target.value;
                if (value === '') return;
                onMoveTestcase(codename, value === SUBTASK_POOL_ZONE_ID ? null : value);
              }}
              aria-label={`Move ${codename} to another subtask`}
              options={[
                { value: SUBTASK_POOL_ZONE_ID, label: 'Unassigned' },
                ...otherGroups.map((candidate) => ({ value: candidate.id, label: candidate.name })),
              ]}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
