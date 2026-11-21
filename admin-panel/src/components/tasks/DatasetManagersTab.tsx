'use client';

import { useRef, useState } from 'react';
import { FileText, Loader2, Trash2, FileCode, Upload } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { apiClient } from '@/lib/apiClient';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { readFileAsBase64 } from '@/lib/file-helpers';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { hasEffectivePermission } from '@/lib/permission-engine';

interface Manager {
  id: number;
  filename: string;
  digest: string;
}

interface DatasetManagersTabProps {
  datasetId: number;
  managers: Manager[];
  loadingManagers: boolean;
  onReload: () => void;
  permissionKeys: readonly string[];
}

export function DatasetManagersTab({
  datasetId,
  managers,
  loadingManagers,
  onReload,
  permissionKeys,
}: DatasetManagersTabProps): React.JSX.Element {
  const effective = new Set(permissionKeys);
  // Why these keys: the managers routes enforce manager:create on upload,
  // manager:delete on removal, and manager:read on load.
  const canUpload = hasEffectivePermission(effective, 'manager:create');
  const canDelete = hasEffectivePermission(effective, 'manager:delete');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const { destructiveConfirm } = useConfirmationCopy();
  const runAction = useActionFeedback();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const base64 = await readFileAsBase64(file);
      const res = await runAction(
        {
          pending: 'Uploading manager file...',
          success: 'Manager file uploaded',
          failure: 'Upload failed',
          description: `"${file.name}" saved successfully.`,
        },
        () =>
          apiClient.post(`/api/datasets/${datasetId}/managers`, {
            filename: file.name,
            fileData: base64,
          })
      );
      if (res?.success) onReload();
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: number): Promise<void> => {
    if (!(await confirm(destructiveConfirm('managerFile')))) return;
    try {
      const res = await runAction(
        { pending: 'Deleting manager file...', success: 'Manager file deleted', failure: 'Delete failed' },
        () => apiClient.delete(`/api/managers/${id}`)
      );
      if (res?.success) onReload();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-foreground">Manager Files</h3>
          <p className="text-sm text-muted-foreground">Custom checkers, graders, and libraries.</p>
        </div>
        <div>
          <input type="file" ref={fileInputRef} className="hidden" onChange={handleUpload} />
          {canUpload && (
          <Button
            variant="positiveOutline"
            size="sm"
            icon={Upload}
            loading={uploading}
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            Upload File
          </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {loadingManagers ? (
          <div className="flex justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : managers.length === 0 ? (
          <EmptyState icon={FileCode} title="No manager files uploaded" description="Upload files like `checker`, `grader`, `*.lib.h`." />
        ) : (
          managers.map((manager) => (
            <div key={manager.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border">
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4 text-success" />
                <div>
                  <div className="text-sm font-medium text-foreground">{manager.filename}</div>
                  <div className="text-xs text-muted-foreground font-mono">{manager.digest ? `${manager.digest.substring(0, 8)}...` : 'no digest'}</div>
                </div>
              </div>
              {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                iconOnly
                tooltip="Delete manager file"
                onClick={() => { void handleDelete(manager.id); }}
              />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
