'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Dialog } from '@/components/core/Dialog';
import { Button } from '@/components/core/Button';
import { apiClient } from '@/lib/apiClient';
import { STATEMENT_LANGUAGES } from '@/lib/constants';
import { readFileAsBase64 } from '@/lib/file-helpers';

interface StatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: number;
  existingLanguages: string[];
  onSuccess: () => void;
}

export function StatementModal({ isOpen, onClose, taskId, existingLanguages, onSuccess }: StatementModalProps): React.JSX.Element | null {
  const [language, setLanguage] = useState('en');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const availableLanguages = STATEMENT_LANGUAGES.filter((l) => !existingLanguages.includes(l.code) || l.code === language);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!file) {
      setError('Please select a file');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const base64 = await readFileAsBase64(file);
      const result = await apiClient.post('/api/statements', { taskId, language, fileData: base64 });
      if (result.success) {
        onSuccess();
        onClose();
        setFile(null);
      } else {
        setError(result.error ?? 'Failed to upload statement');
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
      title="Add Statement"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" form="statement-form" variant="positive" icon={Upload} loading={loading} disabled={loading || !file}>
            Upload Statement
          </Button>
        </>
      }
      className="sm:max-w-md"
    >
      {error && <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      <form id="statement-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-2 block text-xs font-bold uppercase text-muted-foreground">Language</label>
          <select value={language} onChange={(event) => setLanguage(event.target.value)} className="w-full rounded-lg border border-border bg-muted/50 px-4 py-3 text-foreground focus:border-ring focus:outline-none">
            {availableLanguages.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name} ({lang.code})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-xs font-bold uppercase text-muted-foreground">PDF File</label>
          <div className="relative">
            <input type="file" accept=".pdf" onChange={handleFileChange} className="hidden" id="statement-file" />
            <label htmlFor="statement-file" className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-muted-foreground transition-colors hover:bg-muted/50 hover:border-ring/50">
              <Upload className="w-5 h-5" />
              {file ? file.name : 'Click to select PDF file'}
            </label>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
