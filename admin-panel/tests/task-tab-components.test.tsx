import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskOverviewTab } from '@/components/tasks/task-detail/TaskOverviewTab';
import { TaskDatasetsTab } from '@/components/tasks/task-detail/TaskDatasetsTab';
import { TaskFilesTab } from '@/components/tasks/task-detail/TaskFilesTab';
import { TaskSettingsTab } from '@/components/tasks/task-detail/TaskSettingsTab';

const task = {
  id: 9,
  name: 'task-nine',
  title: 'Task Nine',
  score_precision: 0,
  score_mode: 'max',
  feedback_level: 'restricted',
  submissions: 4,
};

describe('Task tab components', () => {
  it('renders overview without a datasets property', () => {
    const html = renderToStaticMarkup(<TaskOverviewTab data={{ task, statements: [], permissionKeys: ['task:read'] }} />);
    // Why: the layout's fact strip carries the task's configuration, so the tab must not repeat it.
    expect(html).not.toContain('Configuration');
    expect(html).toContain('Statements');
    expect(html).not.toContain('datasets');
  });

  it('renders dataset empty state and current action labels', () => {
    const html = renderToStaticMarkup(<TaskDatasetsTab data={{ taskId: 9, activeDatasetId: null, datasets: [], permissionKeys: ['task:read', 'dataset:read', 'dataset:create', 'testcase:read'] }} />);
    // Why no "Datasets" heading assertion: the page's fact strip and the tab rail say it, so the
    // tab is left with the action and the empty meaning.
    expect(html).toContain('Create Dataset');
    expect(html).toContain('No datasets created yet');
  });

  it('renders file empty state and upload action', () => {
    const html = renderToStaticMarkup(<TaskFilesTab data={{ taskId: 9, attachments: [], permissionKeys: ['task:read', 'attachment:read', 'attachment:create'] }} />);
    expect(html).toContain('Attachments');
    expect(html).toContain('Upload');
  });

  it('renders Task settings without unrelated relations', () => {
    const html = renderToStaticMarkup(<TaskSettingsTab data={{ task: { ...task, allowed_languages: [], submission_format: [], token_mode: 'disabled', token_max_number: null, token_min_interval: null, token_gen_initial: null, token_gen_number: null, token_gen_interval: null, token_gen_max: null, max_submission_number: null, max_user_test_number: null, min_submission_interval: null, min_user_test_interval: null, evaluation_throttle_delay_s: null }, permissionKeys: ['task:read', 'task:update'] }} />);
    expect(html).not.toContain('Task Settings');
    expect(html).toContain('Score mode');
    expect(html).not.toContain('Datasets');
    expect(html).not.toContain('Attachments');
  });
});
