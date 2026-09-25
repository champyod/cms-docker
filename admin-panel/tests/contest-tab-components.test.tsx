import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContestOverviewTab } from '@/components/contests/contest-detail/ContestOverviewTab';
import { ContestTasksTab } from '@/components/contests/contest-detail/ContestTasksTab';
import { ContestParticipantsTab } from '@/components/contests/contest-detail/ContestParticipantsTab';
import { ContestSettingsTab } from '@/components/contests/contest-detail/ContestSettingsTab';

const settings = {
  contestId: 7,
  fields: {
    name: 'Contest Seven', description: 'Description', timezone: 'Asia/Bangkok',
    allow_questions: true, allow_user_tests: false, submissions_download_allowed: true,
    allow_password_authentication: true, allow_registration: false, analysis_enabled: false,
    token_mode: 'disabled', score_precision: 0, start: null, stop: null,
    analysis_start: null, analysis_stop: null,
  },
  permissionKeys: ['contest:read', 'contest:update'],
};

describe('Contest tab components', () => {
  it('renders overview timing without Participant or Task relations', () => {
    const html = renderToStaticMarkup(<ContestOverviewTab data={{ contest: { id: 7, name: 'Contest Seven', description: 'Description', is_active: true, start: null, stop: null, analysis_start: null, analysis_stop: null, permissionKeys: ['contest:read'] }, permissionKeys: ['contest:read'] }} />);
    expect(html).toContain('Contest Status');
    expect(html).not.toContain('participations');
  });

  it('renders task empty state and action label', () => {
    const html = renderToStaticMarkup(<ContestTasksTab data={{ contestId: 7, tasks: [], availableTasks: [], permissionKeys: ['contest:read', 'task:read', 'task:update'] }} />);
    expect(html).toContain('No tasks assigned to this contest');
    expect(html).toContain('Add Task');
  });

  it('renders participant empty state and action label', () => {
    const html = renderToStaticMarkup(<ContestParticipantsTab data={{ contestId: 7, participations: [], availableUsers: [], teams: [], permissionKeys: ['contest:read', 'participation:read', 'participation:create'] }} />);
    expect(html).toContain('No participants yet');
    expect(html).toContain('Add Participant');
  });

  it('renders settings fields and save action', () => {
    const html = renderToStaticMarkup(<ContestSettingsTab data={settings} />);
    expect(html).toContain('Contest Settings');
    expect(html).toContain('Save Changes');
  });
});
