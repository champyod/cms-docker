'use client';

import { DndContext, PointerSensor, useDroppable, useSensor, type DragEndEvent } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { SubtaskRow } from './dataset-score-params';
import { groupsFromRows, poolFromGroups, rowsFromGroups, SUBTASK_POOL_ZONE_ID, type SubtaskGroup } from './subtask-board';
import { SubtaskGroupCard } from './SubtaskGroupCard';
import { SubtaskChip } from './SubtaskChip';

interface SubtaskBoardProps {
  scoreType: string;
  rows: readonly SubtaskRow[];
  testcases: readonly string[];
  onRowsChange: (rows: SubtaskRow[]) => void;
}

interface SubtaskBoardActions {
  moveTestcase: (codename: string, targetGroupId: string | null) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  addGroup: () => void;
  removeGroup: (groupId: string) => void;
  updateGroup: (groupId: string, patch: Partial<SubtaskGroup>) => void;
}

function codenameSort(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true });
}

function useSubtaskBoardActions(
  groups: readonly SubtaskGroup[],
  testcases: readonly string[],
  onRowsChange: (rows: SubtaskRow[]) => void,
): SubtaskBoardActions {
  const moveTestcase = (codename: string, targetGroupId: string | null): void => {
    const next = groups.map((group) => ({
      ...group,
      testcases: group.testcases.filter((candidate) => candidate !== codename),
    }));
    if (targetGroupId !== null) {
      const target = next.find((group) => group.id === targetGroupId);
      if (target) target.testcases = [...target.testcases, codename].sort(codenameSort);
    }
    onRowsChange(rowsFromGroups(next, testcases));
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over) return;
    const codename = String(active.id);
    const targetGroupId = String(over.id) === SUBTASK_POOL_ZONE_ID ? null : String(over.id);
    const sourceGroup = groups.find((group) => group.testcases.includes(codename));
    if ((sourceGroup ? sourceGroup.id : null) === targetGroupId) return;
    moveTestcase(codename, targetGroupId);
  };

  const addGroup = (): void => {
    const next: SubtaskGroup = {
      id: `subtask-${groups.length}`,
      name: `Subtask ${groups.length + 1}`,
      maxScore: '',
      threshold: '1',
      testcases: [],
    };
    onRowsChange(rowsFromGroups([...groups, next], testcases));
  };

  const removeGroup = (groupId: string): void => {
    onRowsChange(rowsFromGroups(groups.filter((group) => group.id !== groupId), testcases));
  };

  const updateGroup = (groupId: string, patch: Partial<SubtaskGroup>): void => {
    const next = groups.map((group) => (group.id === groupId ? { ...group, ...patch } : group));
    onRowsChange(rowsFromGroups(next, testcases));
  };

  return { moveTestcase, handleDragEnd, addGroup, removeGroup, updateGroup };
}

export function SubtaskBoard({ scoreType, rows, testcases, onRowsChange }: SubtaskBoardProps): React.JSX.Element {
  const sensor = useSensor(PointerSensor, { activationConstraint: { distance: 4 } });
  const groups = useMemo(() => groupsFromRows(rows, testcases), [rows, testcases]);
  const pool = useMemo(() => poolFromGroups(groups, testcases), [groups, testcases]);
  const derivedRows = useMemo(() => rowsFromGroups(groups, testcases), [groups, testcases]);
  const actions = useSubtaskBoardActions(groups, testcases, onRowsChange);

  if (testcases.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        Upload testcases for this dataset first, then drag them into subtasks here.
      </p>
    );
  }

  return (
    <DndContext sensors={[sensor]} onDragEnd={actions.handleDragEnd}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <SubtaskGroupCard
              key={group.id}
              group={group}
              scoreType={scoreType}
              canRemove={groups.length > 1}
              otherGroups={groups.filter((candidate) => candidate.id !== group.id)}
              onUpdate={(patch) => actions.updateGroup(group.id, patch)}
              onRemove={() => actions.removeGroup(group.id)}
              onMoveTestcase={actions.moveTestcase}
            />
          ))}
          <SubtaskPoolCard pool={pool} />
        </div>
        <BoardFooter
          groups={groups}
          pool={pool}
          derivedRows={derivedRows}
          onAddGroup={actions.addGroup}
        />
      </div>
    </DndContext>
  );
}

interface BoardFooterProps {
  groups: readonly SubtaskGroup[];
  pool: readonly string[];
  derivedRows: readonly SubtaskRow[];
  onAddGroup: () => void;
}

function BoardFooter({ groups, pool, derivedRows, onAddGroup }: BoardFooterProps): React.JSX.Element {
  const assigned = groups.reduce((total, group) => total + group.testcases.length, 0);
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onAddGroup}
          className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 text-muted-foreground rounded-lg text-sm hover:bg-muted transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add subtask
        </button>
        <span className="text-xs text-muted-foreground">
          {assigned} of {assigned + pool.length} testcases assigned
        </span>
      </div>
      <div>
        <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Resulting score parameters</label>
        <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs text-foreground">
{JSON.stringify(derivedRows, null, 2)}
        </pre>
        {groups.some((group) => group.testcases.length === 0) && (
          <p className="text-xs text-destructive mt-2">
            A subtask with no testcases is rejected by the CMS when the dataset is saved.
          </p>
        )}
      </div>
    </>
  );
}

function SubtaskPoolCard({ pool }: { pool: readonly string[] }): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: SUBTASK_POOL_ZONE_ID });
  return (
    <div ref={setNodeRef} className={cn('flex flex-col gap-2 rounded-xl border border-dashed p-3 transition-colors', isOver ? 'border-ring bg-ring/10' : 'border-border bg-muted/10')}>
      <span className="text-sm font-semibold text-muted-foreground">Unassigned ({pool.length})</span>
      <div className="flex flex-wrap gap-1.5">
        {pool.length === 0 && <span className="text-xs text-muted-foreground">Every testcase belongs to a subtask</span>}
        {pool.map((codename) => (
          <SubtaskChip key={codename} codename={codename} />
        ))}
      </div>
    </div>
  );
}
