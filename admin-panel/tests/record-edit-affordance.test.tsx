// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import { TaskRecordHeader } from '@/components/tasks/TaskRecordHeader';
import { UserRecordHeader } from '@/components/users/UserRecordHeader';
import { TeamRecordHeader } from '@/components/teams/TeamRecordHeader';
import { getTaskSettings } from '@/app/actions/tasks';
import { getUserEditData } from '@/app/actions/users';
import { getTeamEditData } from '@/app/actions/teams';

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/en/tasks/9',
}));

vi.mock('@/app/actions/tasks', () => ({ getTaskSettings: vi.fn() }));
vi.mock('@/app/actions/users', () => ({ getUserEditData: vi.fn() }));
vi.mock('@/app/actions/teams', () => ({ getTeamEditData: vi.fn() }));

// Why the stubs: the affordance under test is the header, and each real modal
// pulls its own API client, dictionary and field-access surface. The stub
// surfaces the record the header handed over so the click path stays provable.
vi.mock('@/components/tasks/TaskModal', () => ({
  TaskModal: ({ task }: { task: { id: number } }) => <div data-testid="task-modal" data-record-id={String(task.id)} />,
}));
vi.mock('@/components/users/UserModal', () => ({
  UserModal: ({ user }: { user: { id: number } }) => <div data-testid="user-modal" data-record-id={String(user.id)} />,
}));
vi.mock('@/components/teams/TeamModal', () => ({
  TeamModal: ({ initialData }: { initialData: { id: number } }) => <div data-testid="team-modal" data-record-id={String(initialData.id)} />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockGetTaskSettings = vi.mocked(getTaskSettings);
const mockGetUserEditData = vi.mocked(getUserEditData);
const mockGetTeamEditData = vi.mocked(getTeamEditData);

const TASK_SETTINGS = {
  task: {
    id: 9, name: 'task-nine', title: 'Task Nine', score_mode: 'max', feedback_level: 'restricted',
    score_precision: 0, allowed_languages: [], submission_format: [], token_mode: 'disabled',
    token_max_number: null, token_min_interval: null, token_gen_initial: null, token_gen_number: null,
    token_gen_interval: null, token_gen_max: null, max_submission_number: null, max_user_test_number: null,
    min_submission_interval: null, min_user_test_interval: null,
  },
  permissionKeys: ['task:read', 'task:update'],
};

const USER_ROW = {
  id: 17, username: 'ada', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com',
  timezone: 'Asia/Bangkok', preferred_languages: ['en'],
};

const TEAM_ROW = { id: 4, code: 'A-1', name: 'Alpha' };

function renderTask(permissionKeys: readonly string[]): void {
  render(
    <TaskRecordHeader
      taskId={9}
      name="task-nine"
      title="Task Nine"
      contest={{ id: 3, name: 'Thailand Cup' }}
      permissionKeys={permissionKeys}
    />,
  );
}

function renderUser(permissionKeys: readonly string[]): void {
  render(
    <UserRecordHeader
      userId={17}
      permissionKeys={permissionKeys}
      navigation={en.navigation}
    />,
  );
}

function renderTeam(permissionKeys: readonly string[]): void {
  render(
    <TeamRecordHeader
      teamId={4}
      permissionKeys={permissionKeys}
      navigation={en.navigation}
    />,
  );
}

/** Why the three: the visible label and the icon are one affordance, a label swap without the icon swap is exactly the drift this guards, and the modal must stay closed until the click lands. The accessible name is asserted separately because only the new headers must keep it equal to the visible label (WCAG 2.5.3). */
function expectEditAffordance(label: string, testId: string, accessibleName = label): void {
  const button = screen.getByRole('button', { name: accessibleName });
  expect(button.textContent).toBe(label);
  expect(button.querySelector('.lucide-pencil')).not.toBeNull();
  expect(screen.queryByTestId(testId)).toBeNull();
}

async function expectModalOpens(testId: string, recordId: number): Promise<void> {
  await waitFor(() => expect(screen.getByTestId(testId)).not.toBeNull());
  expect(screen.getByTestId(testId).getAttribute('data-record-id')).toBe(String(recordId));
}

describe('Task record edit affordance', () => {
  it('offers Edit Task with the Pencil icon to a reader holding task:update', () => {
    mockGetTaskSettings.mockResolvedValue(TASK_SETTINGS);
    renderTask(['task:read', 'task:update']);
    // Why the third argument: the Task button keeps its pre-existing aria-label,
    // so its accessible name names the record while its visible label is the action.
    expectEditAffordance('Edit Task', 'task-modal', 'Edit Task Nine');
  });

  it('withholds the Edit Task button from a reader without task:update', () => {
    renderTask(['task:read']);
    expect(screen.queryByText('Edit Task')).toBeNull();
    expect(screen.queryByText('Task Settings')).toBeNull();
  });

  it('fetches the task record on click and opens the edit modal with it', async () => {
    mockGetTaskSettings.mockResolvedValue(TASK_SETTINGS);
    renderTask(['task:read', 'task:update']);

    expect(mockGetTaskSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Edit Task/ }));

    await expectModalOpens('task-modal', 9);
    expect(mockGetTaskSettings).toHaveBeenCalledWith(9);
  });
});

describe('User record edit affordance', () => {
  it('offers Edit User with the Pencil icon to a reader holding user:update', () => {
    mockGetUserEditData.mockResolvedValue(USER_ROW);
    renderUser(['user:read', 'user:update']);
    expectEditAffordance('Edit User', 'user-modal');
  });

  it('withholds the Edit User button from a reader without user:update', () => {
    renderUser(['user:read']);
    expect(screen.queryByText('Edit User')).toBeNull();
  });

  it('fetches the user row on click and opens the edit modal with it', async () => {
    mockGetUserEditData.mockResolvedValue(USER_ROW);
    renderUser(['user:read', 'user:update']);

    expect(mockGetUserEditData).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Edit User' }));

    await expectModalOpens('user-modal', 17);
    expect(mockGetUserEditData).toHaveBeenCalledWith(17);
  });
});

describe('Team record edit affordance', () => {
  it('offers Edit Team with the Pencil icon to a reader holding team:update', () => {
    mockGetTeamEditData.mockResolvedValue(TEAM_ROW);
    renderTeam(['team:read', 'team:update']);
    expectEditAffordance('Edit Team', 'team-modal');
  });

  it('withholds the Edit Team button from a reader without team:update', () => {
    renderTeam(['team:read']);
    expect(screen.queryByText('Edit Team')).toBeNull();
  });

  it('fetches the team record on click and opens the edit modal with it', async () => {
    mockGetTeamEditData.mockResolvedValue(TEAM_ROW);
    renderTeam(['team:read', 'team:update']);

    expect(mockGetTeamEditData).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Team' }));

    await expectModalOpens('team-modal', 4);
    expect(mockGetTeamEditData).toHaveBeenCalledWith(4);
  });
});
