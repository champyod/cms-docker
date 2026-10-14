import { apiClient } from '@/lib/apiClient';
import { readFileAsBase64 } from '@/lib/file-helpers';
import { normalizeLanguageCode } from '@/lib/constants/languages';

export interface QueuedStatement {
  file: File;
  language: string;
}

// Why: a statement row needs a persisted task id, so the create flows hold the
// chosen files here and flush them once the task exists.
export async function uploadStatements(taskId: number, queue: readonly QueuedStatement[]): Promise<{ failed: string[] }> {
  const failed: string[] = [];
  for (const item of queue) {
    const language = normalizeLanguageCode(item.language);
    if (!language) {
      failed.push(item.file.name);
      continue;
    }
    try {
      const fileData = await readFileAsBase64(item.file);
      const result = await apiClient.post('/api/statements', { taskId, language, fileData });
      if (!result.success) failed.push(item.file.name);
    } catch {
      failed.push(item.file.name);
    }
  }
  return { failed };
}
