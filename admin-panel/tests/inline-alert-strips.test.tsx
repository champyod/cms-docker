// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { AdminModal } from '@/components/admins/AdminModal';
import { BulkDialogs } from '@/components/containers/BulkDialogs';
import { ContainerSettingsModal } from '@/components/containers/ContainerSettingsModal';
import { ParticipationEditModal } from '@/components/contests/ParticipationEditModal';
import { ParticipationModal } from '@/components/contests/ParticipationModal';
import { TeamBulkAddModal } from '@/components/contests/TeamBulkAddModal';
import { GroupDeleteDialog } from '@/components/groups/GroupDeleteDialog';
import { GroupFormDialog } from '@/components/groups/GroupFormDialog';
import { AttachmentModal } from '@/components/tasks/AttachmentModal';
import { DatasetGeneralForm } from '@/components/tasks/DatasetGeneralForm';
import { StatementModal } from '@/components/tasks/StatementModal';
import { TaskModal } from '@/components/tasks/TaskModal';
import { TeamModal } from '@/components/teams/TeamModal';
import { HeaderWarnings, SubmitResultBanner } from '@/components/users/bulkCreateSections';
import { UserBulkEditDialog } from '@/components/users/UserBulkEditDialog';
import { UserModal } from '@/components/users/UserModal';
import { getDiscordWebhookStatus } from '@/lib/discord-notifier';
import type { SelectedUser } from '@/components/users/bulkEditActions';

afterEach(() => cleanup());

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/apiClient', () => {
  const reject = vi.fn(() => Promise.resolve({ success: false, error: 'Save failed' }));
  return { apiClient: { get: reject, post: reject, put: reject } };
});
vi.mock('@/app/actions/participations', () => ({
  getParticipationDetails: vi.fn(() => Promise.reject(new Error('offline'))),
  updateParticipation: vi.fn(() => Promise.resolve({ success: false, error: 'Participation rejected' })),
  addTeamToContest: vi.fn(() => Promise.resolve({ success: false, error: 'Team already in contest' })),
  revealParticipationPassword: vi.fn(() => Promise.resolve({ success: true, data: null })),
  sendMessage: vi.fn(() => Promise.resolve({ success: false, error: 'Send rejected' })),
}));
vi.mock('@/app/actions/admins', () => ({
  getAdmins: vi.fn(() => Promise.resolve([])),
  createAdmin: vi.fn(() => Promise.resolve({ success: true, data: null })),
  updateAdmin: vi.fn(() => Promise.resolve({ success: true, data: null })),
  revealAdminPassword: vi.fn(() => Promise.resolve({ success: true, data: null })),
}));
vi.mock('@/app/actions/adminPermissions', () => ({
  getAdminAccess: vi.fn(() => Promise.resolve({ success: true, data: null })),
  setAdminGroups: vi.fn(() => Promise.resolve({ success: true })),
  setAdminOverride: vi.fn(() => Promise.resolve({ success: true })),
  clearAdminOverride: vi.fn(() => Promise.resolve({ success: true })),
  listGroupsWithPermissions: vi.fn(() => Promise.resolve({ success: true, data: [] })),
}));
vi.mock('@/app/actions/users', () => ({ revealUserPassword: vi.fn(() => Promise.resolve({ success: true, data: null })) }));
vi.mock('@/app/actions/teams', () => ({ getTeams: vi.fn(() => Promise.resolve({ success: true, data: [] })) }));
vi.mock('@/app/actions/containerConfig', () => ({
  getContainerConfig: vi.fn(() => Promise.resolve({})),
  updateContainerConfig: vi.fn(() => Promise.resolve({ success: true })),
  resetRestartCount: vi.fn(() => Promise.resolve({ success: true })),
}));
vi.mock('@/lib/discord-notifier', () => ({ getDiscordWebhookStatus: vi.fn(() => Promise.resolve({ configured: true })) }));
vi.mock('@/components/users/bulkEditActions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/users/bulkEditActions')>()),
  submitCredentialUpdates: vi.fn((_rows, _closeAfter, _onClose, _onSuccess, setters) => {
    setters.setLoading(false);
    setters.setErrorMessage('Bulk apply failed');
    return Promise.resolve();
  }),
}));

type Tone = 'info' | 'success' | 'warning' | 'destructive';

/**
 * The typography a strip is authored at, held as whole class tokens so a
 * per-site `className` override cannot quietly take ownership of it again.
 */
interface StripScale {
  readonly present: readonly string[];
  readonly absent: readonly string[];
}

const PAGE_SCALE: StripScale = { present: ['p-4', 'text-sm'], absent: ['p-3', 'text-xs'] };
const REGULAR_SCALE: StripScale = { present: ['p-3', 'text-sm'], absent: ['p-4', 'text-xs'] };

/** Pins the three things a strip is: it announces itself, it wears one tone, it says its message. */
function expectStrip(tone: Tone, message: string, role: 'alert' | 'status' = 'alert'): HTMLElement {
  const strip = screen.getByRole(role);
  expect(strip.className).toContain(`border-${tone}/`);
  expect(strip.textContent).toContain(message);
  return strip;
}

function expectScale(strip: HTMLElement, scale: StripScale): void {
  const tokens = strip.className.split(' ');
  for (const token of scale.present) expect(tokens).toContain(token);
  for (const token of scale.absent) expect(tokens).not.toContain(token);
}

function submitForm(): void {
  const form = document.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('no form rendered');
  fireEvent.submit(form);
}

const NOOP = (): void => undefined;
const BULK_USERS: SelectedUser[] = [
  { id: 1, first_name: 'A', last_name: 'B', username: 'ab', email: 'a@b.c', password: null, stored_kind: 'bcrypt' },
];
const DATASET_FORM = { description: '', time_limit: 1, memory_limit: 256, task_type: 'Batch', score_type: 'Sum', score_type_parameters: {}, task_type_parameters_text: '[]' };
const CONTAINER = { autoRestart: true, maxRestarts: 5, currentRestarts: 0, discordNotifications: true };

function openContainerSettings(config: typeof CONTAINER, onClose: () => void = NOOP): void {
  render(<ContainerSettingsModal containerId="api" containerName="api" config={config} onClose={onClose} onUpdate={NOOP} />);
}

function openBulkUserEdit(): void {
  render(<UserBulkEditDialog isOpen onClose={NOOP} selectedUsers={BULK_USERS} contests={[]} canReadContests={false} navigation={en.navigation} onSuccess={NOOP} />);
}

function openBulkDialogs(isDiscordConfigured: boolean | null): void {
  render(
    <DictionaryProvider dict={en}>
      <BulkDialogs copy={en.containers.bulk} selectedCount={1} selectedNames={['api']} restartPreview={[]} isDiscordConfigured={isDiscordConfigured} bulkLoading={false} showRestart={false} showRemove showLogs={false} setShowRestart={NOOP} setShowRemove={NOOP} setShowLogs={NOOP} onConfirmRestart={NOOP} onConfirmRemove={NOOP} onConfirmLogs={NOOP} />
    </DictionaryProvider>,
  );
}

// Why one table: every strip here is the same contract — a message the reader did not just
// cause, rendered through InlineAlert — so only the seam that raises it differs per case.
function stripping(label: string, message: string, node: React.ReactNode, scale: StripScale, trigger?: () => void): { label: string; message: string; scale: StripScale; raise: () => void } {
  return { label, message, scale, raise: (): void => { render(node); trigger?.(); } };
}

const FAILURE_CASES = [
  stripping('participation create', 'Failed to load participation data',
    <ParticipationModal isOpen onClose={NOOP} participationId={4} username="ada" teams={[]} onSuccess={NOOP} />, REGULAR_SCALE),
  stripping('group create', 'Group name is required',
    <GroupFormDialog open setOpen={NOOP} selectedGroup={null} dict={en.groups} formData={{ name: '', description: '', permissionKeys: [], reason: '' }} setFormData={NOOP} groupedPermissions={new Map()} effectivePreview={new Set<string>()} error="Group name is required" loading={false} onTogglePermission={NOOP} onToggleModule={NOOP} onSave={NOOP} />, REGULAR_SCALE),
  stripping('group delete', 'Group is still referenced',
    <GroupDeleteDialog open setOpen={NOOP} dict={en.groups} error="Group is still referenced" deleteReason="" setDeleteReason={NOOP} loading={false} onDelete={NOOP} />, REGULAR_SCALE),
  stripping('dataset form', 'Dataset description is required',
    <DatasetGeneralForm formData={DATASET_FORM} onChange={NOOP} onSubmit={NOOP} error="Dataset description is required" scoreParamsError="" taskParamsError="" onScoreParamsChange={NOOP} onScoreParamsError={NOOP} onTaskParamsTextChange={NOOP} />, PAGE_SCALE),
  stripping('admin create', 'Name and Username are required',
    <AdminModal isOpen onClose={NOOP} onSuccess={NOOP} initialData={null} callerPermissions={['admin:create']} canRevealPassword={false} />, REGULAR_SCALE, submitForm),
  stripping('user create', 'Save failed',
    <UserModal isOpen onClose={NOOP} onSuccess={NOOP} canReadContests={false} permissionKeys={['user:read', 'user:update']} navigation={en.navigation} />, REGULAR_SCALE, submitForm),
  stripping('team create', 'All fields are required',
    <TeamModal isOpen onClose={NOOP} onSuccess={NOOP} permissionKeys={['team:read', 'team:update']} navigation={en.navigation} />, REGULAR_SCALE, submitForm),
  stripping('task create', 'Save failed',
    <TaskModal isOpen onClose={NOOP} onSuccess={NOOP} />, PAGE_SCALE, submitForm),
  stripping('attachment upload', 'Please select a file',
    <AttachmentModal isOpen onClose={NOOP} taskId={4} onSuccess={NOOP} />, REGULAR_SCALE, submitForm),
  stripping('statement upload', 'Please select a file',
    <StatementModal isOpen onClose={NOOP} taskId={4} existingLanguages={['en']} onSuccess={NOOP} />, REGULAR_SCALE, submitForm),
  {
    label: 'participation edit', message: 'Participation rejected', scale: REGULAR_SCALE,
    raise: (): void => {
      render(<ParticipationEditModal isOpen onClose={NOOP} adminId={2} participation={{ id: 4, hidden: false, unrestricted: false, password: null, users: { username: 'ada', first_name: 'A', last_name: 'B' } }} />);
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    },
  },
  {
    label: 'team bulk add', message: 'Team already in contest', scale: REGULAR_SCALE,
    raise: (): void => {
      render(<TeamBulkAddModal isOpen onClose={NOOP} contestId={1} teams={[{ id: 3, name: 'Thailand', code: 'THA' }]} onSuccess={NOOP} />);
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '3' } });
      submitForm();
    },
  },
];

const NOTE_CASES: ReadonlyArray<{ label: string; tone: Tone; message: string; open: () => void }> = [
  { label: 'auto-restart off', tone: 'warning', message: 'Container will NOT restart automatically on failure.', open: (): void => openContainerSettings({ ...CONTAINER, autoRestart: false }) },
  { label: 'discord notifications off', tone: 'warning', message: 'Discord notifications disabled.', open: (): void => openContainerSettings({ ...CONTAINER, discordNotifications: false }) },
];

describe('every save-failure strip announces itself in the destructive tone', () => {
  it.each(FAILURE_CASES)('$label names its failure at the scale the primitive owns', async ({ message, scale, raise }) => {
    raise();
    const strip = await vi.waitFor(() => expectStrip('destructive', message));
    expectScale(strip, scale);
  });
});

describe('the container and bulk notes keep the compact warning scale', () => {
  it.each(NOTE_CASES)('$label announces itself at the compact scale', async ({ tone, message, open }) => {
    open();
    const alert = await vi.waitFor(() => expectStrip(tone, message));
    expect(alert.className).toContain('p-3');
    expect(alert.className).toContain('text-xs');
  });

  it('scales the restart-limit note down to its own tighter box', () => {
    openContainerSettings({ ...CONTAINER, currentRestarts: 5 });
    expect(expectStrip('destructive', 'Restart limit reached!').className).toContain('p-2');
  });

  it('keeps the bulk discord notice polite, since the webhook state was not the reader doing', () => {
    openBulkDialogs(false);
    const strip = expectStrip('warning', en.containers.discordWarning, 'status');
    expect(strip.className).toContain('p-2');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('announces an unconfigured discord webhook on the enabled tab', async () => {
    vi.mocked(getDiscordWebhookStatus).mockResolvedValueOnce({ configured: false });
    openContainerSettings(CONTAINER);
    await vi.waitFor(() => expectStrip('warning', 'Discord webhook is not configured.'));
  });
});

describe('the bulk user and create strips announce their own outcome tone', () => {
  it('reports the local regeneration in the success tone', () => {
    openBulkUserEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate Username' }));
    expect(expectStrip('success', 'Locally regenerated username for 1 user(s)').className).toContain('border-success/30');
  });

  it('reports a failed apply in the destructive tone', async () => {
    openBulkUserEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Apply Credentials' }));
    await vi.waitFor(() => expectStrip('destructive', 'Bulk apply failed'));
  });

  it('keeps every csv header warning in one warning strip', () => {
    render(<HeaderWarnings warnings={['Row 2 has 3 cells', 'Row 9 is missing a team']} />);
    const alert = expectStrip('warning', 'Row 2 has 3 cells');
    expect(alert.className).toContain('border-warning/30');
    expect(alert.textContent).toContain('Row 9 is missing a team');
  });

  it('keeps the created and failed counts with the download action', () => {
    const onDownload = vi.fn();
    render(<SubmitResultBanner result={{ success: true, createdCount: 4, failedCount: 1, downloadUrl: '/x', failed: [{ rowIndex: 7, reason: 'bad email' }] }} onDownloadCredentials={onDownload} />);
    const alert = expectStrip('success', 'Created: 4 | Failed: 1');
    expect(alert.className).toContain('border-success/30');
    expect(alert.textContent).toContain('Row 7: bad email');
    fireEvent.click(screen.getByRole('button', { name: 'Download Credentials CSV' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('keeps the fallback failure copy in the destructive tone', () => {
    render(<SubmitResultBanner result={{ success: false }} onDownloadCredentials={() => undefined} />);
    expect(expectStrip('destructive', 'Bulk create failed').className).toContain('border-destructive/30');
  });
});
