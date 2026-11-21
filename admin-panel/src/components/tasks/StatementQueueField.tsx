'use client';

import { useId } from 'react';
import { Upload, X } from 'lucide-react';
import { LanguagePicker } from '@/components/core/LanguagePicker';
import type { QueuedStatement } from '@/lib/statement-upload';

interface StatementQueueFieldProps {
  queue: QueuedStatement[];
  onChange: (next: QueuedStatement[]) => void;
  disabled?: boolean;
}

const DEFAULT_LANGUAGE = 'en';

// Why: create holds its files client-side until the task exists, so the same
// editor serves the create dialog and the already-saved edit flow.
export function StatementQueueField({ queue, onChange, disabled = false }: StatementQueueFieldProps): React.JSX.Element {
  const inputId = useId();

  const addFiles = (files: FileList | null): void => {
    if (!files || files.length === 0) return;
    onChange([...queue, ...Array.from(files).map((file) => ({ file, language: DEFAULT_LANGUAGE }))]);
  };

  const setLanguage = (index: number, language: string): void => {
    onChange(queue.map((item, position) => (position === index ? { ...item, language } : item)));
  };

  const remove = (index: number): void => {
    onChange(queue.filter((_, position) => position !== index));
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-2 block text-xs font-bold uppercase text-muted-foreground">Statement PDFs</label>
        <input
          type="file"
          accept=".pdf"
          multiple
          disabled={disabled}
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = '';
          }}
          className="hidden"
          id={inputId}
        />
        <label
          htmlFor={inputId}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-muted-foreground transition-colors hover:border-ring/50 hover:bg-muted/50"
        >
          <Upload className="h-4 w-4" />
          Click to select PDF files
        </label>
      </div>

      {queue.length > 0 && (
        <ul className="space-y-2">
          {queue.map((item, index) => (
            <li key={`${item.file.name}-${index}`} className="flex items-center gap-3 rounded-lg bg-muted/30 p-3">
              <div className="min-w-0 flex-1">
                <LanguagePicker
                  value={item.language}
                  onChange={(language) => setLanguage(index, language)}
                  label="Language"
                  id={`${inputId}-language-${index}`}
                />
              </div>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={item.file.name}>{item.file.name}</span>
              <button type="button" onClick={() => remove(index)} disabled={disabled} className="text-muted-foreground transition-colors hover:text-destructive" aria-label={`Remove ${item.file.name}`}>
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
