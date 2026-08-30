'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Dialog } from '@/components/core/Dialog';
import { Button } from '@/components/core/Button';
import { apiClient } from '@/lib/apiClient';
import { readFileAsBase64 } from '@/lib/file-helpers';

interface AttachmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: number;
  onSuccess: () => void;
}

export function AttachmentModal({ isOpen, onClose, taskId, onSuccess }: AttachmentModalProps): React.JSX.Element | null {
  const [file, setFile] = useState<File | null>(null);
  const [customFilename, setCustomFilename] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    if (!customFilename) setCustomFilename(selected.name);
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!file) {
      setError('Please select a file');
      return;
    }
    const filename = customFilename.trim() || file.name;
    if (!filename) {
      setError('Please provide a filename');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const base64 = await readFileAsBase64(file);
      const result = await apiClient.post('/api/attachments', { taskId, filename, fileData: base64 });
      if (result.success) {
        onSuccess();
        onClose();
        setFile(null);
        setCustomFilename('');
      } else {
        setError(result.error ?? 'Failed to upload attachment');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Add Attachment"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" form="attachment-form" variant="positive" icon={Upload} loading={loading} disabled={loading || !file}>
            Upload Attachment
          </Button>
        </>
      }
      className="sm:max-w-md"
    >
      {error && <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      <form id="attachment-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-2 block text-xs font-bold uppercase text-muted-foreground">File</label>
          <div className="relative">
            <input type="file" onChange={handleFileChange} className="hidden" id="attachment-file" />
            <label htmlFor="attachment-file" className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-muted-foreground transition-colors hover:bg-muted/50 hover:border-ring/50">
              <Upload className="w-5 h-5" />
              {file ? file.name : 'Click to select file'}
            </label>
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs font-bold uppercase text-muted-foreground">Filename (as shown to contestants)</label>
          <input type="text" value={customFilename} onChange={(event) => setCustomFilename(event.target.value)} placeholder="e.g., sample_data.zip" className="w-full rounded-lg border border-border bg-muted/50 px-4 py-3 text-foreground focus:border-ring focus:outline-none" />
        </div>
      </form>
    </Dialog>
  );
}
