'use client';

import { Settings } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { hasEffectivePermission } from '@/lib/permission-engine';
import type { TaskSettingsData } from '@/lib/queries/task-detail';
import { TaskModal } from '../TaskModal';
import { useTaskSettingsState } from './useTaskSettingsState';

export type TaskSettingsTabProps = { data: TaskSettingsData };

export function TaskSettingsTab({ data }: TaskSettingsTabProps): React.JSX.Element {
  const state = useTaskSettingsState();
  // Why: the settings reader carries only task:read — without task:update
  // the edit affordance never appears and the record stays read-only.
  const canEdit = hasEffectivePermission(new Set(data.permissionKeys), 'task:update');
  return (
    <div className="space-y-6">
      <Card className="border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-primary" />
            <span className="font-bold text-foreground">Task Settings</span>
          </div>
          {canEdit && (
            <Button variant="positiveOutline" icon={Settings} onClick={state.open}>
              Edit Task
            </Button>
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-lg border border-border bg-muted/30 p-3"><label className="mb-1 block text-xs font-bold uppercase text-muted-foreground">Score Mode</label><div className="text-sm capitalize text-foreground">{data.task.score_mode.replace(/_/g, ' ')}</div></div>
          <div className="rounded-lg border border-border bg-muted/30 p-3"><label className="mb-1 block text-xs font-bold uppercase text-muted-foreground">Feedback</label><div className="text-sm capitalize text-foreground">{data.task.feedback_level.replace(/_/g, ' ')}</div></div>
          <div className="rounded-lg border border-border bg-muted/30 p-3"><label className="mb-1 block text-xs font-bold uppercase text-muted-foreground">Score Precision</label><div className="text-sm text-foreground">{data.task.score_precision ?? '-'}</div></div>
          <div className="rounded-lg border border-border bg-muted/30 p-3"><label className="mb-1 block text-xs font-bold uppercase text-muted-foreground">Token Mode</label><div className="text-sm capitalize text-foreground">{data.task.token_mode.replace(/_/g, ' ')}</div></div>
        </div>
      </Card>
      {state.isOpen && (
        <TaskModal
          isOpen
          onClose={state.close}
          task={data.task}
          onSuccess={state.refresh}
          permissionKeys={data.permissionKeys}
        />
      )}
    </div>
  );
}
