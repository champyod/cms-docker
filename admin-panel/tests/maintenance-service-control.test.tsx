// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import en from '@/dictionaries/en.json';

/** The card decides a stack outage, so it warns before the press and the restart carries a reason. */
const { boundMock, restartMock } = vi.hoisted(() => ({
  boundMock: vi.fn(),
  restartMock: vi.fn(),
}));

vi.mock('@/app/actions/contests', () => ({ getBoundContestId: boundMock }));
vi.mock('@/app/actions/services', () => ({
  getDeploymentMode: async () => ({ mode: 'img', resolved: true }),
  restartServices: restartMock,
  updateServer: async () => ({ success: true }),
}));
vi.mock('@/app/actions/docker-ops', () => ({
  pullLatestImages: async () => ({ success: true }),
  rebuildImages: async () => ({ success: true }),
}));
// The dialog resolves copy through the router, which a bare render lacks.
vi.mock('next/navigation', () => ({ usePathname: () => '/en/administration/settings' }));

const { ManualServiceControlCard } = await import('@/components/settings/MaintenanceControls');

const copy = en.settings.serviceControl;
const restartLabels = en.confirmations.restartStack.labels;

function renderCard(): void {
  render(
    <DictionaryProvider dict={en}>
      <ManualServiceControlCard />
    </DictionaryProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the manual service control card', () => {
  it('warns before the buttons when a contest is bound to the stack', async () => {
    boundMock.mockResolvedValue({
      success: true,
      binding: { source: 'registry', contestId: 7, matchedBy: 'declared-shard' },
    });

    renderCard();

    expect(await screen.findByText(/Contest #7/)).toBeTruthy();
  });

  it('stays quiet when the registry names no contest', async () => {
    boundMock.mockResolvedValue({
      success: true,
      binding: { source: 'deployment', contestId: null, matchedBy: null },
    });

    renderCard();

    await waitFor(() => expect(boundMock).toHaveBeenCalled());
    expect(screen.queryByText(/Contest #/)).toBeNull();
    expect(screen.queryByText(copy.contestLiveRestartUnknown)).toBeNull();
  });

  it('warns rather than staying quiet when the binding cannot be read', async () => {
    // Fail-safe: a missing warning is the dangerous direction.
    boundMock.mockRejectedValue(new Error('registry unreachable'));

    renderCard();

    expect(await screen.findByText(copy.contestLiveRestartUnknown)).toBeTruthy();
  });

  it('asks for a reason and passes the typed reason to the action', async () => {
    boundMock.mockResolvedValue({
      success: true,
      binding: { source: 'registry', contestId: 7, matchedBy: 'declared-shard' },
    });
    restartMock.mockResolvedValue({ success: true, message: 'Services (core) restarted.' });

    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: restartLabels.core }));

    const field = await screen.findByRole('textbox');
    fireEvent.change(field, { target: { value: 'patching the host kernel' } });
    fireEvent.click(screen.getByRole('button', { name: en.confirmations.restartStack.confirmLabel }));

    await waitFor(() => expect(restartMock).toHaveBeenCalledWith('core', undefined, 'patching the host kernel'));
  });

  it('does not restart when the reason is left blank', async () => {
    boundMock.mockResolvedValue({
      success: true,
      binding: { source: 'registry', contestId: null, matchedBy: null },
    });

    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: restartLabels.core }));

    const field = await screen.findByRole('textbox');
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: en.confirmations.restartStack.confirmLabel }));

    expect(await screen.findByText(en.reasonDialog.required)).toBeTruthy();
    expect(restartMock).not.toHaveBeenCalled();
  });
});
