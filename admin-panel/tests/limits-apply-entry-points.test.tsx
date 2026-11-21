// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { DeployContestProvider } from '@/components/providers/DeployContestProvider';
import { defaultNewContestForm } from '@/components/contests/contest-modal/contestFormMappers';
import { LimitsTab as ContestLimitsTab } from '@/components/contests/contest-modal/tabs/LimitsTab';
import { TokensTab as ContestTokensTab } from '@/components/contests/contest-modal/tabs/TokensTab';
import { ContestList } from '@/components/contests/ContestList';
import { LimitsTab as TaskLimitsTab, TokensTab as TaskTokensTab } from '@/components/tasks/task-modal-sections';
import { TaskList } from '@/components/tasks/TaskList';
import type { ContestFormData } from '@/components/contests/contest-modal/types';
import type { TaskData } from '@/app/actions/tasks';

const mocks = vi.hoisted(() => ({ listLimitTargets: vi.fn(), push: vi.fn() }));

vi.mock('@/app/actions/limitTargets', () => ({
  listLimitTargets: mocks.listLimitTargets.mockResolvedValue([{ id: 9, label: 'sum' }]),
}));
vi.mock('@/app/actions/deployActions', () => ({
  deployContest: vi.fn(async () => ({ success: true, operationId: 'op-1' })),
  fetchActiveDeployOperation: vi.fn(async () => null),
}));
vi.mock('@/app/actions/contests', () => ({
  getContestEditData: vi.fn(async () => null),
  activateContest: vi.fn(async () => ({ success: true })),
  getAvailableContests: vi.fn(async () => ({ success: true, contests: [] })),
}));
vi.mock('@/lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.push,
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/en/contests',
}));
vi.mock('sonner', () => ({ toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() } }));

const TASK = {
  id: 5,
  name: 'sum',
  title: 'Sum',
  contest_tasks: [],
  statements: [],
  datasets_datasets_task_idTotasks: [],
  _count: { submissions: 0 },
  diagnostics: [],
};
const CONTEST = { id: 4, name: 'Autumn', is_active: true, start: new Date('2026-01-01'), stop: new Date('2026-12-01'), timezone: 'Asia/Bangkok' };

function withDictionary(node: React.ReactNode): React.JSX.Element {
  return <DictionaryProvider dict={en}>{node}</DictionaryProvider>;
}

function dialogField(id: string): string {
  const input = document.getElementById(id);
  if (!(input instanceof HTMLInputElement)) throw new Error(`no dialog field ${id}`);
  return input.value;
}

function openApplyTo(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Apply to…' }));
}

async function dialogOpensWith(): Promise<void> {
  await screen.findByRole('dialog', { name: en.limits.apply.title });
}

afterEach(() => cleanup());

describe('the contest modal tabs push the form limits to tasks', () => {
  it('opens the picker from the Limits tab, targeting tasks, with the four form limits seeded', async () => {
    const formData: ContestFormData = {
      ...defaultNewContestForm(),
      max_submission_number: 12,
      max_user_test_number: 3,
      min_submission_interval: 45,
      min_user_test_interval: 90,
    };
    render(withDictionary(<ContestLimitsTab formData={formData} setFormData={vi.fn()} validationErrors={new Map()} />));

    openApplyTo();
    await dialogOpensWith();

    expect(screen.getByText('Tasks')).toBeTruthy();
    expect(screen.queryByText('Contests')).toBeNull();
    expect(dialogField('apply-max_submission_number')).toBe('12');
    expect(dialogField('apply-max_user_test_number')).toBe('3');
    expect(dialogField('apply-min_submission_interval')).toBe('45');
    expect(dialogField('apply-min_user_test_interval')).toBe('90');
    // The contests-only fields are not part of a task-targeted write.
    expect(document.getElementById('apply-per_user_time')).toBeNull();
    expect(document.getElementById('apply-token_max_number')).toBeNull();
  });

  it('opens the picker from the Tokens tab with the two token caps seeded', async () => {
    const formData: ContestFormData = { ...defaultNewContestForm(), token_max_number: 42, token_gen_max: 7 };
    render(withDictionary(<ContestTokensTab formData={formData} setFormData={vi.fn()} validationErrors={new Map()} />));

    openApplyTo();
    await dialogOpensWith();

    expect(screen.getByText('Tasks')).toBeTruthy();
    expect(dialogField('apply-token_max_number')).toBe('42');
    expect(dialogField('apply-token_gen_max')).toBe('7');
    expect(document.getElementById('apply-max_submission_number')).toBeNull();
  });
});

describe('the task modal tabs push the form limits to contests', () => {
  const formData: TaskData = {
    name: 'sum',
    title: 'Sum',
    max_submission_number: 8,
    max_user_test_number: 2,
    min_submission_interval: 30,
    min_user_test_interval: 60,
    token_max_number: 5,
    token_gen_max: 4,
  };

  it('opens the picker from the Limits tab, targeting contests, with the four form limits seeded', async () => {
    render(withDictionary(<TaskLimitsTab formData={formData} onChange={vi.fn()} />));

    openApplyTo();
    await dialogOpensWith();

    expect(screen.getByText('Contests')).toBeTruthy();
    expect(screen.queryByText('Tasks')).toBeNull();
    expect(dialogField('apply-max_submission_number')).toBe('8');
    expect(dialogField('apply-max_user_test_number')).toBe('2');
    expect(dialogField('apply-min_submission_interval')).toBe('30');
    expect(dialogField('apply-min_user_test_interval')).toBe('60');
    expect(document.getElementById('apply-token_max_number')).toBeNull();
  });

  it('opens the picker from the Tokens tab with the two token caps seeded', async () => {
    render(withDictionary(<TaskTokensTab formData={formData} onChange={vi.fn()} />));

    openApplyTo();
    await dialogOpensWith();

    expect(screen.getByText('Contests')).toBeTruthy();
    expect(dialogField('apply-token_max_number')).toBe('5');
    expect(dialogField('apply-token_gen_max')).toBe('4');
    expect(document.getElementById('apply-max_submission_number')).toBeNull();
  });
});

describe('the list bulk bars open the same dialog on the checked rows', () => {
  it('keeps the Edit limits action hidden until a row is checked, then preselects it', async () => {
    render(withDictionary(<TaskList initialTasks={[TASK]} totalPages={1} currentPage={1} permissionKeys={['task:update']} />));

    expect(screen.queryByRole('button', { name: en.limits.apply.editButton })).toBeNull();

    fireEvent.click(screen.getAllByLabelText('Select task 5')[0]);
    fireEvent.click(screen.getByRole('button', { name: en.limits.apply.editButton }));
    const dialog = await screen.findByRole('dialog', { name: en.limits.apply.title });

    // The checked row seeds its own kind only; both kinds stay selectable in the same picker.
    expect(screen.getByTestId('apply-targets-count').textContent).toBe('1 selected');
    expect(within(dialog).getByText('Contests')).toBeTruthy();
    expect(within(dialog).getByText('Tasks')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply to 1 selected' })).toBeTruthy();
  });

  it('carries the checked contests into the picker', async () => {
    render(
      withDictionary(
        <DeployContestProvider>
          <ContestList initialContests={[CONTEST]} totalPages={1} permissionKeys={['contest:update']} />
        </DeployContestProvider>,
      ),
    );

    expect(screen.queryByRole('button', { name: en.limits.apply.editButton })).toBeNull();

    fireEvent.click(screen.getAllByLabelText('Select contest 4')[0]);
    fireEvent.click(screen.getByRole('button', { name: en.limits.apply.editButton }));
    const dialog = await screen.findByRole('dialog', { name: en.limits.apply.title });

    expect(screen.getByTestId('apply-targets-count').textContent).toBe('1 selected');
    expect(within(dialog).getByText('Contests')).toBeTruthy();
    expect(within(dialog).getByText('Tasks')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply to 1 selected' })).toBeTruthy();
  });
});
