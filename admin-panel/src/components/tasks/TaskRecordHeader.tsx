'use client';

import { useState } from 'react';
import { ExternalLink, Settings } from 'lucide-react';
import { useParams } from 'next/navigation';
import { getTaskSettings } from '@/app/actions/tasks';
import { Button } from '@/components/core/Button';
import { hasEffectivePermission } from '@/lib/permission-engine';
import type { TaskSettingsRecord } from '@/lib/queries/task-detail';
import { TaskModal } from './TaskModal';
import { useTaskTabRefresh } from './task-detail/useTaskTabRefresh';

export type TaskRecordHeaderProps = {
  taskId: number;
  name: string;
  title: string;
  contest: { id: number; name: string } | null;
  permissionKeys: readonly string[];
};

// Why: the tab contract carries no locale, so the contest link resolves it
// from the route — useParams is null-safe without a provider.
function useHeaderLocale(): string {
  const params = useParams() as { locale?: unknown } | null;
  const candidate = params?.locale;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : 'en';
}

// Why: the layout already renders the record title and description, so the
// header owns only the contest link and the gated settings action — the
// settings record loads on demand, keeping the header summary-only.
export function TaskRecordHeader({ taskId, title, contest, permissionKeys }: TaskRecordHeaderProps): React.JSX.Element {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsRecord, setSettingsRecord] = useState<TaskSettingsRecord | null>(null);
  const refresh = useTaskTabRefresh();
  const locale = useHeaderLocale();
  const canEdit = hasEffectivePermission(new Set(permissionKeys), 'task:update');

  const openSettings = async (): Promise<void> => {
    const settings = await getTaskSettings(taskId);
    if (!settings) return;
    setSettingsRecord(settings.task);
    setIsSettingsOpen(true);
  };

  const closeSettings = (): void => {
    setIsSettingsOpen(false);
    setSettingsRecord(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {contest && (
        <a href={`/${locale}/contests/${contest.id}`} className="flex items-center gap-1 text-sm text-primary hover:underline">
          Contest: {contest.name}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {canEdit && (
        <Button variant="secondary" icon={Settings} onClick={() => { void openSettings(); }} aria-label={`Edit ${title}`}>
          Task Settings
        </Button>
      )}
      {isSettingsOpen && settingsRecord && (
        <TaskModal
          isOpen
          onClose={closeSettings}
          task={settingsRecord}
          onSuccess={refresh}
          permissionKeys={permissionKeys}
        />
      )}
    </div>
  );
}
