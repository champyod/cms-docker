// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ContestRecordHeader } from '@/components/contests/contest-detail/ContestRecordHeader';
import { DeployContestProvider } from '@/components/providers/DeployContestProvider';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { deployContest } from '@/app/actions/deployActions';
import en from '@/dictionaries/en.json';

/**
 * The record header's "Set as Active Contest" control is the only way to set the active contest from
 * a contest record. It used to be removed outright when the acting admin lacked `deployment:deploy`,
 * so an operator without the grant saw no control and could not tell a missing permission from a
 * broken panel. These tests pin the gate as a visible, disabled control that names the missing key.
 */
const PERMITTED = ['contest:read', 'contest:update', 'deployment:deploy'];
const WITHOUT_DEPLOY = ['contest:read', 'contest:switch', 'contest:update'];
const MISSING_KEY_HINT = /deployment:deploy/;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => '/en/contests',
}));
vi.mock('@/app/actions/deployActions', () => ({
  deployContest: vi.fn(async () => ({ success: true, operationId: 'op-1' })),
  fetchActiveDeployOperation: vi.fn(async () => null),
}));
vi.mock('@/app/actions/contests', () => ({
  getContestEditData: vi.fn(async () => null),
  activateContest: vi.fn(async () => ({ success: true })),
}));
vi.mock('sonner', () => ({ toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn(), info: vi.fn() } }));

afterEach(() => cleanup());

function renderHeader(permissionKeys: readonly string[], isActive = false): void {
  render(
    <DictionaryProvider dict={en}>
      <DeployContestProvider>
        <ContestRecordHeader contestId={4} name="Autumn" description="" isActive={isActive} permissionKeys={permissionKeys} />
      </DeployContestProvider>
    </DictionaryProvider>,
  );
}

describe('contest record deploy control', () => {
  it('offers an enabled deploy control that opens the confirm dialog and starts the deploy for an admin who may deploy', async () => {
    renderHeader(PERMITTED);

    const deploy = screen.getByRole('button', { name: 'Set as Active Contest' });
    expect((deploy as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(deploy);
    expect(await screen.findByRole('dialog')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));
    expect(vi.mocked(deployContest)).toHaveBeenCalledWith(4);
  });

  it('keeps the control visible but disabled, naming the missing permission, when the admin may not deploy', () => {
    renderHeader(WITHOUT_DEPLOY);

    const deploy = screen.getByRole('button', { name: MISSING_KEY_HINT });
    expect((deploy as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(deploy);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('omits the control on the already-active contest', () => {
    renderHeader(PERMITTED, true);

    expect(screen.queryByRole('button', { name: 'Set as Active Contest' })).toBeNull();
    expect(screen.queryByRole('button', { name: MISSING_KEY_HINT })).toBeNull();
  });
});
