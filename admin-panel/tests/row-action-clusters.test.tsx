// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Pencil, Trash2 } from 'lucide-react';

import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { RowActions } from '@/components/core/RowActions';
import { AdminRowActions } from '@/components/admins/AdminRowActions';
import { ContainerRow } from '@/components/containers/ContainerRow';
import { ContestRowActions, type ContestRowData } from '@/components/contests/contest-list/ContestTableRows';
import { QuestionsPanel, type QuestionRow } from '@/components/contests/contest-communications/QuestionsPanel';
import { GroupList } from '@/components/groups/GroupList';
import { TaskList } from '@/components/tasks/TaskList';
import type { GroupWithPermissions } from '@/lib/admin-access-types';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => '/en/tasks',
}));
vi.mock('@/app/actions/groups', () => ({ createGroup: vi.fn(), updateGroup: vi.fn(), deleteGroup: vi.fn() }));
vi.mock('@/lib/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() } }));

// Why: globals are off in vitest.config.ts, so without this a later row query
// would bind to the accumulated document.body.
afterEach(() => cleanup());

const CONTAINER_CONFIG = { autoRestart: true, maxRestarts: 3, currentRestarts: 0, discordNotifications: true };
const CONTAINER = { id: 'abc123', name: 'api', image: 'cms/api', status: 'Up 2 days', created: '', isCmsContainer: true };
const CONTEST: ContestRowData = { id: 4, name: 'Autumn', is_active: true, start: new Date('2026-01-01'), stop: new Date('2026-12-01') };
const GROUP: GroupWithPermissions = { id: 3, name: 'Judges', description: null, is_seeded: false, permissionKeys: [] };
const QUESTION: QuestionRow = { id: 9, subject: 'Scoring', text: 'How is it scored?', ignored: false, reply_timestamp: null, reply_subject: null, reply_text: null, question_timestamp: '2026-01-02T03:04:00Z', participations: { users: { username: 'ada' } } };
const TASK = { id: 5, name: 'sum', title: 'Sum', contests: null, statements: [], datasets_datasets_task_idTotasks: [], _count: { submissions: 0 }, diagnostics: [] };

type QuestionsPanelProps = React.ComponentProps<typeof QuestionsPanel>;

function noop(): void {
  return undefined;
}

function withDictionary(node: React.ReactNode): React.JSX.Element {
  return <DictionaryProvider dict={en}>{node}</DictionaryProvider>;
}

/** Why: the cluster only counts as migrated while every action keeps the 44px target. */
function expectTouchTarget(button: Element): void {
  expect(button.className).toContain('h-11');
  expect(button.className).toContain('w-11');
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled === true;
}

/** Why the wrapper: a row action must not also run the click handler of the record row around it. */
function renderInsideRow(node: React.ReactNode, onRowClick: () => void): void {
  render(withDictionary(<div onClick={onRowClick}>{node}</div>));
}

function adminActions(permissionKeys: readonly string[]): React.JSX.Element {
  return <AdminRowActions permissionKeys={permissionKeys} editLabel="Edit admin" deleteLabel="Delete admin" onEdit={noop} onDelete={noop} />;
}

function contestActions(permissionKeys: readonly string[]): React.JSX.Element {
  return <ContestRowActions contest={CONTEST} permissionKeys={permissionKeys} onSetActive={noop} onEdit={noop} />;
}

function containerRow(state: string, onToggleSelection: () => void, actionLoading: string | null = null): React.JSX.Element {
  return <ContainerRow container={{ ...CONTAINER, state }} config={CONTAINER_CONFIG} restartCount={0} actionLoading={actionLoading} onViewLogs={noop} onOpenSettings={noop} onControl={noop} onToggleAutoRestart={noop} onResetRestartCount={noop} onToggleDiscordNotifications={noop} onToggleSelection={onToggleSelection} />;
}

function questionPanel(overrides: Partial<QuestionsPanelProps>): React.JSX.Element {
  return <QuestionsPanel questions={[QUESTION]} replyingTo={null} replySubject="" replyText="" permissionKeys={['question:answer', 'question:ignore']} onReplyingTo={noop} onReplySubject={noop} onReplyText={noop} onReply={noop} onIgnore={noop} {...overrides} />;
}

function groupList(permissionKeys: readonly string[]): React.JSX.Element {
  return <GroupList groups={[GROUP]} permissionKeys={permissionKeys} dict={en.groups} />;
}

function taskList(permissionKeys: readonly string[]): React.JSX.Element {
  return <TaskList initialTasks={[TASK]} totalPages={1} permissionKeys={permissionKeys} />;
}

describe('admin row actions', () => {
  it('keeps 44px targets, per-button tints, and the click inside the cluster', () => {
    const onRowClick = vi.fn();
    renderInsideRow(adminActions(['admin:update', 'admin:delete']), onRowClick);
    const edit = screen.getByRole('button', { name: 'Edit admin' });
    const remove = screen.getByRole('button', { name: 'Delete admin' });
    expect(screen.getByRole('group', { name: en.rowActions.admins })).not.toBeNull();
    expectTouchTarget(edit);
    expectTouchTarget(remove);
    expect(edit.className).toContain('hover:text-primary');
    expect(remove.className).toContain('hover:text-destructive');
    expect(remove.className).not.toContain('hover:text-primary');
    fireEvent.click(edit);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  // Why rewritten: it used to assert one `canEdit` boolean for two permissions. The two entry
  // permissions are now named separately, so a reader holding only one of them still gets Edit.
  it('offers edit on either entry permission, and delete only on admin:delete', () => {
    const cases = [[['admin:password:update'], true, false], [['admin:update'], true, false], [['admin:delete'], false, true]] as const;
    for (const [keys, edit, remove] of cases) {
      render(withDictionary(adminActions([...keys])));
      expect(screen.queryByRole('button', { name: 'Edit admin' }) !== null).toBe(edit);
      expect(screen.queryByRole('button', { name: 'Delete admin' }) !== null).toBe(remove);
      cleanup();
    }
  });
});

describe('contest row actions', () => {
  it('names the record on the action, keeps 44px targets, and stops the click', () => {
    const onRowClick = vi.fn();
    renderInsideRow(contestActions(['contest:update', 'deployment:deploy', 'contest:delete']), onRowClick);
    const edit = screen.getByRole('button', { name: 'Edit Autumn' });
    expect(screen.getByRole('group', { name: en.rowActions.contests })).not.toBeNull();
    expectTouchTarget(edit);
    expect(edit.getAttribute('title')).toBeNull();
    fireEvent.click(edit);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('withholds edit and set-active for a reader without the key or on an active contest', () => {
    render(withDictionary(contestActions(['deployment:deploy', 'contest:delete'])));
    expect(screen.queryByRole('button', { name: 'Edit Autumn' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set Active' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeNull();
  });
});

describe('container row actions', () => {
  it('offers stop on a running container in the destructive variant and never reaches the row', () => {
    const onToggleSelection = vi.fn();
    renderInsideRow(containerRow('running', onToggleSelection), onToggleSelection);
    const stop = screen.getByRole('button', { name: 'Stop Container' });
    expect(screen.getByRole('group', { name: en.rowActions.containers })).not.toBeNull();
    expectTouchTarget(stop);
    expect(stop.className).toContain('bg-destructive');
    expect(screen.queryByRole('button', { name: 'Start Container' })).toBeNull();
    fireEvent.click(stop);
    expect(onToggleSelection).not.toHaveBeenCalled();
  });

  it('offers start on a stopped container and disables only the pending controls', () => {
    render(withDictionary(containerRow('exited', vi.fn(), 'abc123')));
    expect(isDisabled(screen.getByRole('button', { name: 'Start Container' }))).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: 'Restart Container' }))).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: 'View Logs' }))).toBe(false);
  });
});

describe('question row actions', () => {
  it('names reply per subject, keeps its tint and a 44px target, and stops the click', () => {
    const onRowClick = vi.fn();
    renderInsideRow(questionPanel({}), onRowClick);
    const reply = screen.getByRole('button', { name: 'Reply to Scoring' });
    expect(screen.getByRole('group', { name: en.rowActions.questions })).not.toBeNull();
    expectTouchTarget(reply);
    expect(reply.className).toContain('text-primary');
    fireEvent.click(reply);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('hides reply on an answered question and hides ignore when the gate is withheld', () => {
    render(withDictionary(questionPanel({ questions: [{ ...QUESTION, reply_timestamp: '2026-01-02T04:00:00Z' }] })));
    expect(screen.queryByRole('button', { name: 'Reply to Scoring' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ignore question' })).not.toBeNull();
    cleanup();
    render(withDictionary(questionPanel({ permissionKeys: ['question:answer'] })));
    expect(screen.queryByRole('button', { name: 'Ignore question' })).toBeNull();
  });
});

describe('group row actions', () => {
  it('keeps 44px targets and stops delete from opening the row edit form', () => {
    const onRowClick = vi.fn();
    renderInsideRow(groupList(['group:update', 'group:delete']), onRowClick);
    const removes = screen.getAllByRole('button', { name: en.groups.deleteTooltip });
    expect(screen.getAllByRole('group', { name: en.rowActions.groups })).toHaveLength(2);
    for (const remove of removes) expectTouchTarget(remove);
    fireEvent.click(removes[0]);
    expect(onRowClick).not.toHaveBeenCalled();
    // Why both dialogs: the delete dialog opening proves the action ran, the
    // absent edit form proves the row's own click handler did not.
    expect(screen.queryByText(en.groups.deleteConfirm)).not.toBeNull();
    expect(screen.queryByText(en.groups.editGroup)).toBeNull();
  });

  it('hides delete for a reader without group:delete', () => {
    render(withDictionary(groupList(['group:update'])));
    expect(screen.queryByRole('button', { name: en.groups.deleteTooltip })).toBeNull();
    expect(screen.getAllByRole('button', { name: en.groups.editTooltip }).length).toBe(2);
  });
});

describe('task row actions', () => {
  it('keeps both layouts at 44px and stops edit from opening the task row', () => {
    mockPush.mockClear();
    const onRowClick = vi.fn();
    renderInsideRow(taskList(['task:update', 'task:delete']), onRowClick);
    const edits = screen.getAllByRole('button', { name: 'Edit task' });
    expect(edits).toHaveLength(2);
    expect(screen.getAllByRole('group', { name: en.rowActions.tasks })).toHaveLength(2);
    for (const edit of edits) expectTouchTarget(edit);
    expect(edits[1].className).toContain('hover:text-primary');
    fireEvent.click(edits[1]);
    expect(mockPush).not.toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  // Why both layouts are asserted: the card used to gate Delete on update alone, so a reader
  // with task:update and no task:delete saw a Delete button the server action always refused.
  it('offers delete in both layouts only for a reader holding task:delete', () => {
    render(withDictionary(taskList(['task:update'])));
    expect(screen.queryByRole('button', { name: 'Delete task' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Edit task' })).toHaveLength(2);
    cleanup();
    render(withDictionary(taskList(['task:update', 'task:delete'])));
    expect(screen.getAllByRole('button', { name: 'Delete task' })).toHaveLength(2);
  });

  // Why: the cluster is no longer wrapped in a task:update guard, so a delete-only reader
  // reaches Delete on both layouts and a reader with neither key sees no group at all.
  it('gives a delete-only reader delete alone, and a reader with neither key no cluster', () => {
    render(withDictionary(taskList(['task:delete'])));
    expect(screen.getAllByRole('button', { name: 'Delete task' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Edit task' })).toBeNull();
    cleanup();
    render(withDictionary(taskList(['task:list'])));
    expect(screen.queryByRole('group', { name: en.rowActions.tasks })).toBeNull();
  });
});

describe('the primary marker key', () => {
  it('stays valid while a gate hides the action it names', () => {
    // Why the hidden edit: the key is checked against every action, not the visible ones, so a
    // permission gate on the primary action must not turn into a throw on the next render.
    render(withDictionary(<RowActions ariaLabel="User actions" primaryActionKey="edit" permissionKeys={[]} actions={[
      { key: 'edit', label: 'Edit', icon: Pencil, onClick: () => undefined, permission: 'task:update' },
      { key: 'delete', label: 'Delete', icon: Trash2, onClick: () => undefined },
    ]} />));
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete' }).hasAttribute('data-shortcut-primary')).toBe(false);
  });
});
