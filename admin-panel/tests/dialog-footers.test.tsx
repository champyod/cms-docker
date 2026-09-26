// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { ConfirmDialog } from '@/components/core/ConfirmDialog';
import { PasswordFieldWithGenerator } from '@/components/core/PasswordFieldWithGenerator';
import { BulkDialogs } from '@/components/containers/BulkDialogs';
import { ContainerSettingsModal } from '@/components/containers/ContainerSettingsModal';
import { DeployConfirmModal } from '@/components/contests/DeployConfirmModal';
import { TaskModal } from '@/components/tasks/TaskModal';
import { DatasetModal } from '@/components/tasks/DatasetModal';
import { TestcaseUploadModal } from '@/components/tasks/TestcaseUploadModal';
import { AttachmentModal } from '@/components/tasks/AttachmentModal';
import { StatementModal } from '@/components/tasks/StatementModal';
import { TeamModal } from '@/components/teams/TeamModal';
import { UserModal } from '@/components/users/UserModal';
import { UserBulkEditDialog } from '@/components/users/UserBulkEditDialog';
import { UserBulkCreateCsv } from '@/components/users/UserBulkCreateCsv';
import type { Dictionary } from '@/lib/dictionary';
import type { Dispatch, SetStateAction } from 'react';

afterEach(() => cleanup());

// Why never-settling clients: each dialog owns the loading flag that locks its own
// footer, so a save that never resolves is how a test holds that flag open and can
// observe the confirm lock and the cancel guard in the same pending state.
vi.mock('@/lib/apiClient', () => ({
  apiClient: {
    get: vi.fn(() => new Promise(() => undefined)),
    post: vi.fn(() => new Promise(() => undefined)),
    put: vi.fn(() => new Promise(() => undefined)),
  },
}));
vi.mock('@/app/actions/testcases', () => ({ batchUploadTestcases: vi.fn(() => new Promise(() => undefined)) }));
vi.mock('@/app/actions/teams', () => ({ getTeams: vi.fn(() => Promise.resolve({ success: true, data: [] })) }));
vi.mock('@/app/actions/users', () => ({ revealUserPassword: vi.fn(() => Promise.resolve({ success: true, data: null })) }));
vi.mock('@/app/actions/containerConfig', () => ({
  updateContainerConfig: vi.fn(() => new Promise(() => undefined)),
  resetRestartCount: vi.fn(() => new Promise(() => undefined)),
}));

function withDictionary(node: React.ReactNode): React.JSX.Element {
  return <DictionaryProvider dict={en}>{node}</DictionaryProvider>;
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = screen.getByRole('button', { name });
  if (!(button instanceof HTMLButtonElement)) throw new Error(`no button named ${name}`);
  return button;
}

function isLocked(button: HTMLButtonElement): boolean {
  return button.disabled;
}

function footerRow(): Element | null {
  return document.querySelector('[data-footer-layout]');
}

// Why the form-driven dialogs share one case: each owns a <form> the footer submits
// into, so the contract under test is identical — confirm submits that form, locks
// while the save is in flight, and cancel stops answering until it settles. Only the
// labels, the form id, and whether a file must be attached first differ.
const FORM_FOOTER_CASES = [
  {
    label: 'task',
    confirm: 'Create Task',
    formId: 'task-form',
    // The task confirm never had an icon, and the migration must not add one.
    fileInputId: null,
    open: (onClose: () => void): React.JSX.Element => (
      <TaskModal isOpen onClose={onClose} onSuccess={() => undefined} />
    ),
  },
  {
    label: 'attachment',
    confirm: 'Upload Attachment',
    formId: 'attachment-form',
    fileInputId: 'attachment-file',
    open: (onClose: () => void): React.JSX.Element => (
      <AttachmentModal isOpen onClose={onClose} taskId={4} onSuccess={() => undefined} />
    ),
  },
  {
    label: 'statement',
    confirm: 'Upload Statement',
    formId: 'statement-form',
    fileInputId: 'statement-file',
    open: (onClose: () => void): React.JSX.Element => (
      <StatementModal isOpen onClose={onClose} taskId={4} existingLanguages={['en']} onSuccess={() => undefined} />
    ),
  },
] as const;

function attachFile(inputId: string): void {
  const input = document.getElementById(inputId);
  if (!(input instanceof HTMLInputElement)) throw new Error(`no file input ${inputId}`);
  fireEvent.change(input, { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } });
}

describe('form-driven dialogs submit through the shared footer', () => {
  it.each(FORM_FOOTER_CASES)('$label: confirm submits its own form', ({ confirm, formId, fileInputId, open }) => {
    render(open(() => undefined));
    const button = buttonNamed(confirm);
    expect(button.getAttribute('type')).toBe('submit');
    expect(button.getAttribute('form')).toBe(formId);
    if (fileInputId === null) expect(button.querySelector('svg')).toBeNull();
    else expect(button.querySelector('svg')).not.toBeNull();
  });

  it.each(FORM_FOOTER_CASES)('$label: a pending save locks confirm and refuses cancel', async ({ confirm, fileInputId, open }) => {
    const onClose = vi.fn();
    render(open(onClose));
    if (fileInputId !== null) attachFile(fileInputId);
    const pending = buttonNamed(confirm);
    fireEvent.submit(pending.form as HTMLFormElement);
    await vi.waitFor(() => expect(isLocked(pending)).toBe(true));
    // Why the appearance too: the guard is what refuses the close, so only the
    // disabled button is what tells the reader the dialog is mid-save.
    expect(isLocked(buttonNamed('Cancel'))).toBe(true);
    fireEvent.click(buttonNamed('Cancel'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(FORM_FOOTER_CASES)('$label: cancel still answers while idle', ({ open }) => {
    const onClose = vi.fn();
    render(open(onClose));
    expect(isLocked(buttonNamed('Cancel'))).toBe(false);
    fireEvent.click(buttonNamed('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the dataset footer offers confirm only on the tab that owns the form', () => {
  it('submits the general-tab form from confirm and keeps the save icon', () => {
    render(<DatasetModal isOpen onClose={() => undefined} taskId={4} onSuccess={() => undefined} />);
    const confirm = buttonNamed('Create Dataset');
    expect(confirm.querySelector('svg')).not.toBeNull();
    expect(confirm.getAttribute('type')).toBe('button');
  });

  it('keeps the row cancel-only on the managers tab, where no form is rendered', () => {
    // The managers tab is reachable only for a saved dataset, so this renders the edit case.
    render(
      withDictionary(
        <DatasetModal
          isOpen
          onClose={() => undefined}
          taskId={4}
          onSuccess={() => undefined}
          dataset={{ id: 7, description: 'Sum', time_limit: 1, memory_limit: 1, task_type: 'Batch', score_type: 'Sum' }}
        />,
      ),
    );
    fireEvent.click(buttonNamed('Managers'));
    expect(screen.queryByRole('button', { name: 'Save Changes' })).toBeNull();
    // The dialog's own close control shares this label, so the row's copy is asserted directly.
    expect(footerRow()?.querySelectorAll('button').length).toBe(1);
    expect(footerRow()?.textContent).toBe('Close');
  });
});

describe('the container dialogs keep their own confirm tone', () => {
  const BULK = en.containers.bulk;

  function openBulk(
    which: 'restart' | 'remove' | 'logs',
    overrides: {
      readonly bulkLoading?: boolean;
      readonly setShow?: Dispatch<SetStateAction<boolean>>;
    } = {},
  ): void {
    render(
      withDictionary(
        <BulkDialogs
          copy={BULK}
          selectedCount={1}
          selectedNames={['api']}
          restartPreview={[]}
          isDiscordConfigured
          bulkLoading={overrides.bulkLoading ?? false}
          showRestart={which === 'restart'}
          showRemove={which === 'remove'}
          showLogs={which === 'logs'}
          setShowRestart={overrides.setShow ?? (() => undefined)}
          setShowRemove={() => undefined}
          setShowLogs={() => undefined}
          onConfirmRestart={() => undefined}
          onConfirmRemove={() => undefined}
          onConfirmLogs={() => undefined}
        />,
      ),
    );
  }

  it('stops in the destructive tone and views logs in the neutral one', () => {
    openBulk('remove');
    expect(buttonNamed(BULK.stopConfirm).className).toContain('bg-destructive');
    expect(buttonNamed(BULK.cancel).className).not.toContain('bg-destructive');
    cleanup();
    openBulk('logs');
    expect(buttonNamed(BULK.logsConfirm).className).toContain('bg-secondary');
  });

  it('restarts in the default positive tone and answers cancel through its own setter', () => {
    const setShowRestart = vi.fn();
    openBulk('restart', { setShow: setShowRestart });
    const confirm = buttonNamed(BULK.restartConfirm);
    expect(confirm.className).toContain('bg-primary');
    expect(confirm.querySelector('svg')).not.toBeNull();
    fireEvent.click(buttonNamed(BULK.cancel));
    expect(setShowRestart).toHaveBeenCalledWith(false);
  });

  it('locks the bulk confirm while the bulk action is in flight', () => {
    openBulk('restart', { bulkLoading: true });
    expect(isLocked(buttonNamed(BULK.restartConfirm))).toBe(true);
  });
});

describe('the people dialogs keep their destructive-outline cancel', () => {
  function openTeam(navigation: Dictionary['navigation'], onClose: () => void): void {
    render(
      <TeamModal
        isOpen
        onClose={onClose}
        onSuccess={() => undefined}
        permissionKeys={['team:read', 'team:update']}
        navigation={navigation}
      />,
    );
  }

  it('submits the team form and outlines cancel rather than ghosting it', () => {
    openTeam(en.navigation, () => undefined);
    const confirm = buttonNamed('Create Team');
    expect(confirm.getAttribute('type')).toBe('submit');
    expect(confirm.getAttribute('form')).toBe('team-form');
    const cancel = buttonNamed('Cancel');
    expect(cancel.className).toContain('border-destructive/50');
    expect(cancel.className).not.toContain('hover:bg-accent');
  });

  it('locks the team confirm and refuses cancel while a save is in flight', async () => {
    const onClose = vi.fn();
    openTeam(en.navigation, onClose);
    fireEvent.change(screen.getByPlaceholderText('e.g. THA-01'), { target: { value: 'THA-01' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Thailand Team 1'), { target: { value: 'Thailand' } });
    const pending = buttonNamed('Create Team');
    fireEvent.submit(pending.form as HTMLFormElement);
    await vi.waitFor(() => expect(isLocked(pending)).toBe(true));
    expect(isLocked(buttonNamed('Cancel'))).toBe(true);
    fireEvent.click(buttonNamed('Cancel'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('submits the user form under the same outline-cancel rule', () => {
    render(
      <UserModal
        isOpen
        onClose={() => undefined}
        onSuccess={() => undefined}
        canReadContests={false}
        permissionKeys={['user:read', 'user:update']}
        navigation={en.navigation}
      />,
    );
    expect(buttonNamed('Create User').getAttribute('form')).toBe('user-form');
    expect(buttonNamed('Cancel').className).toContain('border-destructive/50');
  });
});

describe('the container settings dialog keeps Reset ahead of Cancel', () => {
  function openSettings(onClose: () => void): void {
    render(
      <ContainerSettingsModal
        containerId="api"
        containerName="api"
        config={{ autoRestart: true, maxRestarts: 5, currentRestarts: 0, discordNotifications: true }}
        onClose={onClose}
        onUpdate={() => undefined}
      />,
    );
  }

  it('orders the row Reset, Cancel, Save and keeps the labels the dialog always showed', () => {
    openSettings(() => undefined);
    const labels = [...document.querySelectorAll('[data-footer-layout] button')].map((node) => node.textContent);
    expect(labels).toEqual(['Reset Restart Count', 'Cancel', 'Save Settings']);
  });

  it('renames the confirm to Saving... and blocks it while the save runs', async () => {
    openSettings(() => undefined);
    fireEvent.click(buttonNamed('Save Settings'));
    const saving = buttonNamed('Saving...');
    await vi.waitFor(() => expect(isLocked(saving)).toBe(true));
  });
});

describe('the bulk user dialogs lead with their hint and outline cancel', () => {
  const SELECTED = [
    { id: 1, first_name: 'A', last_name: 'B', username: 'ab', email: 'a@b.c', contest_id: null, team_id: null, team_code: null },
  ];

  function openBulkEdit(onClose: () => void): void {
    render(
      <UserBulkEditDialog
        isOpen
        onClose={onClose}
        selectedUsers={SELECTED}
        contests={[]}
        canReadContests={false}
        navigation={en.navigation}
        onSuccess={() => undefined}
      />,
    );
  }

  it('outlines both controls in the bulk edit row', () => {
    openBulkEdit(() => undefined);
    expect(buttonNamed('Done').className).toContain('border-primary/50');
    expect(buttonNamed('Cancel').className).toContain('border-destructive/50');
  });

  it('leads the bulk create row with the generation-mode hint', () => {
    render(
      <UserBulkCreateCsv
        isOpen
        onClose={() => undefined}
        onSuccess={() => undefined}
        contests={[]}
        canReadContests={false}
        navigation={en.navigation}
      />,
    );
    expect(footerRow()?.firstElementChild?.textContent).toContain('Generation mode:');
    expect(isLocked(buttonNamed('Create Users from Preview'))).toBe(true);
  });
});

describe('the testcase upload footer blocks until a pair is ready', () => {
  it('locks Upload while no pair is ready and keeps its icon', () => {
    render(<TestcaseUploadModal isOpen onClose={() => undefined} datasetId={3} onSuccess={() => undefined} />);
    const confirm = buttonNamed('Upload 0 Pairs');
    expect(isLocked(confirm)).toBe(true);
    expect(confirm.querySelector('svg')).not.toBeNull();
  });

  it('keeps cancel live before the CSV parse starts, so the override never over-locks it', () => {
    const onClose = vi.fn();
    render(<TestcaseUploadModal isOpen onClose={onClose} datasetId={3} onSuccess={() => undefined} />);
    expect(isLocked(buttonNamed('Cancel'))).toBe(false);
    fireEvent.click(buttonNamed('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the confirmation overlay keeps one footer row', () => {
  it('repaints confirm per kind and resolves not-confirmed on cancel', () => {
    const onResolve = vi.fn();
    const { unmount } = render(
      withDictionary(
        <ConfirmDialog
          confirmation={{ id: 1, kind: 'destructive', title: 'Delete team?', description: 'Gone for good.', confirmLabel: 'Delete' }}
          onResolve={onResolve}
        />,
      ),
    );
    expect(buttonNamed('Delete').className).toContain('bg-destructive');
    fireEvent.click(buttonNamed('Cancel'));
    expect(onResolve).toHaveBeenCalledWith(false);
    unmount();

    render(
      withDictionary(
        <ConfirmDialog
          confirmation={{ id: 2, kind: 'recoverable', title: 'Unassign task?', description: 'Reversible.', confirmLabel: 'Unassign' }}
          onResolve={onResolve}
        />,
      ),
    );
    expect(buttonNamed('Unassign').className).toContain('bg-primary');
  });

  it('drops the whole row while a deploy is in flight', () => {
    const onClose = vi.fn();
    render(<DeployConfirmModal isOpen phase="idle" targetLabel="Autumn" onClose={onClose} onConfirm={() => undefined} />);
    expect(buttonNamed('Deploy').querySelector('svg')).not.toBeNull();
    fireEvent.click(buttonNamed('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();

    render(<DeployConfirmModal isOpen phase="deploying" targetLabel="Autumn" onClose={onClose} onConfirm={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Deploy' })).toBeNull();
  });
});

describe('the password generator gates only the confirm it owns', () => {
  it('keeps Use Password locked until a password is generated', () => {
    const onChange = vi.fn();
    render(<PasswordFieldWithGenerator value="" onChange={onChange} />);
    // The field's own refresh control opens the dialog; its footer Generate is the
    // second control sharing that accessible name, hence the last match.
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const footerGenerate = screen.getAllByRole('button', { name: 'Generate' }).at(-1);
    if (!(footerGenerate instanceof HTMLButtonElement)) throw new Error('footer Generate missing');
    expect(isLocked(buttonNamed('Use Password'))).toBe(true);
    fireEvent.click(footerGenerate);
    expect(isLocked(buttonNamed('Use Password'))).toBe(false);
    fireEvent.click(buttonNamed('Use Password'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
