'use client';

import { useRef, useState } from 'react';
import { FileText, Loader2, Trash2, Terminal, Upload } from 'lucide-react';
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
          <h3 className="text-lg font-medium text-white">Manager Files</h3>
          <p className="text-sm text-neutral-500">Custom checkers, graders, and libraries.</p>
        </div>
        <div>
          <input type="file" ref={fileInputRef} className="hidden" onChange={handleUpload} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-3 py-1.5 bg-amber-600/20 text-amber-400 rounded-lg text-sm hover:bg-amber-600/30 transition-colors"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Upload File
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {loadingManagers ? (
          <div className="flex justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-neutral-500" />
          </div>
        ) : managers.length === 0 ? (
          <div className="text-center p-8 border border-dashed border-white/10 rounded-lg">
            <Terminal className="w-8 h-8 text-neutral-600 mx-auto mb-2" />
            <p className="text-neutral-400 text-sm">No manager files uploaded.</p>
            <p className="text-neutral-500 text-xs mt-1">Upload files like `checker`, `grader`, `*.lib.h`.</p>
          </div>
        ) : (
          managers.map((manager) => (
            <div key={manager.id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4 text-emerald-400" />
                <div>
                  <div className="text-sm font-medium text-white">{manager.filename}</div>
                  <div className="text-xs text-neutral-500 font-mono">{manager.digest.substring(0, 8)}...</div>
                </div>
              </div>
              <button
                onClick={() => handleDelete(manager.id)}
                className="p-1.5 text-neutral-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
