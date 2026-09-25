'use client';

import type { TaskFilesData } from '@/lib/queries/task-detail';
import { AttachmentModal } from '../AttachmentModal';
import { AttachmentsSection } from '../task-detail-datasets';
import { useTaskFileActions } from './useTaskFileActions';

export type TaskFilesTabProps = { data: TaskFilesData };

export function TaskFilesTab({ data }: TaskFilesTabProps): React.JSX.Element {
  const actions = useTaskFileActions();
  return (
    <div className="space-y-6">
      <AttachmentsSection
        attachments={[...data.attachments]}
        onUpload={actions.openUpload}
        onDeleteAttachment={actions.deleteAttachment}
      />
      {actions.isUploadOpen && (
        <AttachmentModal
          isOpen
          onClose={actions.closeUpload}
          taskId={data.taskId}
          onSuccess={actions.refresh}
        />
      )}
    </div>
  );
}
