import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContestTasksTab } from '@/components/contests/contest-detail/ContestTasksTab';
import { ContestParticipantsTab } from '@/components/contests/contest-detail/ContestParticipantsTab';
import { ContestSettingsTab } from '@/components/contests/contest-detail/ContestSettingsTab';

describe('contest tab parity', () => {
  it('renders task actions and an empty task state without ContestDetailView', () => {
    const html = renderToStaticMarkup(<ContestTasksTab data={{ contestId: 7, tasks: [], availableTasks: [], permissionKeys: ['contest:read', 'task:read', 'task:update'] }} />);
    expect(html).toContain('No tasks assigned to this contest');
    expect(html).toContain('Add Task');
  });

  it('renders participant empty state and action labels', () => {
    const html = renderToStaticMarkup(<ContestParticipantsTab data={{ contestId: 7, participations: [], availableUsers: [], teams: [], permissionKeys: ['contest:read', 'participation:read', 'participation:create'] }} />);
    expect(html).toContain('No participants yet');
    expect(html).toContain('Add Participant');
  });

  it('keeps the current Contest settings form fields', () => {
    const html = renderToStaticMarkup(<ContestSettingsTab data={{ contestId: 7, fields: { name: 'Contest', description: 'Description', timezone: 'Asia/Bangkok', allow_questions: true, allow_user_tests: false, submissions_download_allowed: true, allow_password_authentication: true, allow_registration: false, analysis_enabled: false, token_mode: 'disabled', score_precision: 0, start: null, stop: null, analysis_start: null, analysis_stop: null }, permissionKeys: ['contest:read', 'contest:update'] }} />);
    expect(html).toContain('Contest Settings');
    expect(html).toContain('Timezone');
    expect(html).toContain('Save Changes');
  });
});
