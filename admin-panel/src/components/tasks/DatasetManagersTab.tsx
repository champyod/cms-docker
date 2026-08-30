'use client';

import { useRef, useState } from 'react';
import { FileText, Loader2, Trash2, Terminal, Upload } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { apiClient } from '@/lib/apiClient';
import { readFileAsBase64 } from '@/lib/file-helpers';

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
}

export function DatasetManagersTab({
  datasetId,
  managers,
  loadingManagers,
  onReload,
}: DatasetManagersTabProps): React.JSX.Element {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const base64 = await readFileAsBase64(file);
      const res = await apiClient.post(`/api/datasets/${datasetId}/managers`, {
        filename: file.name,
        fileData: base64,
      });
      if (res.success) onReload();
      else alert(res.error ?? 'Upload failed');
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: number): Promise<void> => {
    if (!confirm('Delete this manager file?')) return;
    try {
      const res = await apiClient.delete(`/api/managers/${id}`);
      if (res.success) onReload();
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
        </div>
      </div>

      <div className="space-y-2">
        {loadingManagers ? (
          <div className="flex justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : managers.length === 0 ? (
          <EmptyState icon={Terminal} title="No manager files uploaded" description="Upload files like `checker`, `grader`, `*.lib.h`." />
        ) : (
          managers.map((manager) => (
            <div key={manager.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border">
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4 text-success" />
                <div>
                  <div className="text-sm font-medium text-foreground">{manager.filename}</div>
                  <div className="text-xs text-muted-foreground font-mono">{manager.digest.substring(0, 8)}...</div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                iconOnly
                tooltip="Delete manager file"
                onClick={() => handleDelete(manager.id)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
