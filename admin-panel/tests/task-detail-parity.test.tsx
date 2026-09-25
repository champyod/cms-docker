import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskDatasetsTab } from '@/components/tasks/task-detail/TaskDatasetsTab';
import { TaskFilesTab } from '@/components/tasks/task-detail/TaskFilesTab';
import { TaskOverviewTab } from '@/components/tasks/task-detail/TaskOverviewTab';
import { TaskSettingsTab } from '@/components/tasks/task-detail/TaskSettingsTab';

// Why: vitest runs ESM where __dirname is undefined — derive it so the
// no-monolith-import guard resolves the migrated component tree directly.
const testDir = dirname(fileURLToPath(import.meta.url));
const tasksDir = join(testDir, '..', 'src', 'components', 'tasks');
const appDir = join(testDir, '..', 'src', 'app');

function collectSources(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const absolute = join(root, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...collectSources(absolute));
    } else if (absolute.endsWith('.ts') || absolute.endsWith('.tsx')) {
      found.push(absolute);
    }
  }
  return found;
}

const overviewTask = {
  id: 9,
  name: 'task-nine',
  title: 'Task Nine',
  score_precision: 0,
  score_mode: 'max',
  feedback_level: 'restricted',
  submissions: 4,
};

describe('task detail parity', () => {
  it('renders overview config, statements, and statement upload/delete controls', () => {
    const html = renderToStaticMarkup(
      <TaskOverviewTab
        data={{
          task: overviewTask,
          statements: [{ id: 11, language: 'en', digest: 'abc123', filename: 'en.pdf', size: 1024, uploadedAt: null }],
          permissionKeys: ['task:read', 'statement:read'],
        }}
      />,
    );
    expect(html).toContain('Configuration');
    expect(html).toContain('Statements');
    expect(html).toContain('Upload Statement');
    expect(html).toContain('/api/statements/abc123');
    expect(html).toContain('Delete statement');
  });

  it('renders datasets with testcase, activate, clone, rename, autojudge, delete, and bulk controls', () => {
    const html = renderToStaticMarkup(
      <TaskDatasetsTab
        data={{
          taskId: 9,
          activeDatasetId: 3,
          datasets: [
            {
              id: 3,
              description: 'Live dataset',
              time_limit: 2,
              memory_limit: '268435456',
              task_type: 'Batch',
              score_type: 'Sum',
              autojudge: true,
              task_type_parameters: {},
              score_type_parameters: {},
              testcases: [{ id: 31, codename: 'sample-01', public: false }],
            },
            {
              id: 4,
              description: 'Draft dataset',
              time_limit: null,
              memory_limit: null,
              task_type: 'Batch',
              score_type: 'Sum',
              autojudge: false,
              task_type_parameters: {},
              score_type_parameters: {},
              testcases: [],
            },
          ],
          permissionKeys: ['task:read', 'dataset:read'],
        }}
      />,
    );
    expect(html).toContain('Live dataset');
    expect(html).toContain('sample-01');
    expect(html).toContain('Make Live');
    expect(html).toContain('Clone');
    expect(html).toContain('Rename');
    expect(html).toContain('Toggle Autojudge');
    expect(html).toContain('Delete');
    expect(html).toContain('Add Testcases (Bulk)');
    expect(html).toContain('Make testcase public');
  });

  it('renders files with attachment upload and delete controls', () => {
    const html = renderToStaticMarkup(
      <TaskFilesTab
        data={{ taskId: 9, attachments: [{ id: 5, filename: 'harness.zip' }], permissionKeys: ['task:read', 'attachment:read'] }}
      />,
    );
    expect(html).toContain('Attachments');
    expect(html).toContain('Upload');
    expect(html).toContain('harness.zip');
    expect(html).toContain('Delete attachment');
  });

  it('renders Task settings without statement, dataset, or attachment data', () => {
    const html = renderToStaticMarkup(
      <TaskSettingsTab
        data={{
          task: {
            ...overviewTask,
            allowed_languages: [],
            submission_format: [],
            token_mode: 'disabled',
            token_max_number: null,
            token_min_interval: null,
            token_gen_initial: null,
            token_gen_number: null,
            token_gen_interval: null,
            token_gen_max: null,
            max_submission_number: null,
            max_user_test_number: null,
            min_submission_interval: null,
            min_user_test_interval: null,
          },
          permissionKeys: ['task:read', 'task:update'],
        }}
      />,
    );
    expect(html).toContain('Task Settings');
    expect(html).toContain('Score Mode');
    expect(html).toContain('Edit Task');
    expect(html).not.toContain('Statements');
    expect(html).not.toContain('Datasets');
    expect(html).not.toContain('Attachments');
  });

  it('keeps every Task tab free of the monolithic view', () => {
    const offenders: string[] = [];
    for (const file of [...collectSources(tasksDir), ...collectSources(appDir)]) {
      if (file.endsWith('TaskDetailView.tsx')) continue;
      if (readFileSync(file, 'utf8').includes('TaskDetailView')) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
