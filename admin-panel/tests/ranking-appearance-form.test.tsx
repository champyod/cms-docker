// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  updateRankingAppearance: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/app/actions/rankingAppearance', () => ({
  updateRankingAppearance: mocks.updateRankingAppearance,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('sonner', () => ({
  toast: { loading: vi.fn(() => 'toast-id'), success: vi.fn(), error: vi.fn() },
}));

import { AppearanceForm } from '@/components/ranking/appearance/AppearanceForm';
import { buildAppearanceSections } from '@/components/ranking/appearance/appearanceSchema';
import type { RankingAppearance } from '@/app/actions/rankingAppearance';
import { MotionGlobalConfig } from 'motion/react';
import en from '@/dictionaries/en.json';

// Why: happy-dom rejects on Animation.cancel() when an unfinished animation is torn down, and
// vitest fails the run on that unhandled rejection; instant animations avoid the driver.
MotionGlobalConfig.skipAnimations = true;

type AppearanceCopy = typeof en.ranking.appearance;

const STORED: RankingAppearance = {
  contestId: '9',
  title: 'POSN Oct 2026',
  subtitle: 'Day 2',
  organisation: 'POSN',
  displayName: 'Oct 2026',
  accessMode: 'public',
  showIdColumn: false,
  anonymous: false,
  footerText: '',
  creditsText: '',
  credits: '',
  theme: '',
  scoreFormat: '',
  perspectives: '',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** The contests the page offers, as the appearance page reads them. */
const CONTESTS = [
  { value: '9', label: 'POSN Oct 2026 - d2' },
  { value: '3', label: 'POSN Oct 2026 - d1' },
];

function renderForm(appearance: RankingAppearance = STORED): HTMLElement {
  const { container } = render(
    <AppearanceForm
      copy={en.ranking.appearance as AppearanceCopy}
      appearance={appearance}
      sections={buildAppearanceSections(en.ranking.appearance as AppearanceCopy, CONTESTS)}
    />,
  );
  return container;
}

function field(container: HTMLElement, name: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (input === null) throw new Error(`the ${name} control is missing`);
  return input;
}

function selectField(container: HTMLElement, name: string): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
  if (select === null) throw new Error(`the ${name} select is missing`);
  return select;
}

function saveButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('button');
  if (button === null) throw new Error('the save control is missing');
  return button;
}

describe('ranking appearance form', () => {
  it('binds every control to the form state rather than to the stored value', () => {
    const container = renderForm();

    expect(field(container, 'title').value).toBe('POSN Oct 2026');
    fireEvent.change(field(container, 'title'), { target: { value: 'Day 2 board' } });

    expect(field(container, 'title').value).toBe('Day 2 board');
  });

  it('posts the text the operator typed, not the value the page rendered', async () => {
    mocks.updateRankingAppearance.mockResolvedValue({
      success: true,
      appearance: { ...STORED, title: 'Day 2 board' },
    });
    const container = renderForm();

    fireEvent.change(field(container, 'title'), { target: { value: 'Day 2 board' } });
    fireEvent.click(saveButton(container));

    await waitFor(() => expect(mocks.updateRankingAppearance).toHaveBeenCalledOnce());
    expect(mocks.updateRankingAppearance.mock.calls[0][0]).toMatchObject({ title: 'Day 2 board' });
  });

  it('keeps what the operator typed when the write fails and says so on the page', async () => {
    mocks.updateRankingAppearance.mockResolvedValue({ success: false, error: 'the row was refused' });
    const container = renderForm();

    fireEvent.change(field(container, 'title'), { target: { value: 'Day 2 board' } });
    fireEvent.click(saveButton(container));

    await waitFor(() => expect(container.textContent).toContain('the row was refused'));
    expect(field(container, 'title').value).toBe('Day 2 board');
  });

  it('re-seeds from the stored row only after a successful write', async () => {
    mocks.updateRankingAppearance.mockResolvedValue({
      success: true,
      appearance: { ...STORED, title: 'Trimmed by the server' },
    });
    const container = renderForm();

    fireEvent.change(field(container, 'title'), { target: { value: '  Trimmed by the server  ' } });
    fireEvent.click(saveButton(container));

    await waitFor(() => expect(field(container, 'title').value).toBe('Trimmed by the server'));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('puts the submit control at the end of the row, as the other settings screens do', () => {
    const container = renderForm();

    const row = saveButton(container).parentElement;
    expect(row?.className).toContain('justify-end');
  });

  it('groups the sections into the page grid and lets the JSON boxes take the row', () => {
    const container = renderForm();

    expect(container.querySelectorAll('.md\\:grid-cols-2').length).toBeGreaterThan(1);
    const theme = container.querySelector('[data-field="theme"]');
    expect(theme?.getAttribute('data-span')).toBe('full');
    expect(theme?.className).toContain('md:col-span-2');
  });

  it('picks the contest the board names from the page list, not a free-typed id', async () => {
    const container = renderForm();
    const select = selectField(container, 'contestId');

    expect(Array.from(select.options).map((option) => option.value)).toEqual(['', '9', '3']);
    expect(select.value).toBe('9');

    fireEvent.change(select, { target: { value: '3' } });
    mocks.updateRankingAppearance.mockResolvedValue({
      success: true,
      appearance: { ...STORED, contestId: '3' },
    });
    fireEvent.click(saveButton(container));

    await waitFor(() => expect(mocks.updateRankingAppearance).toHaveBeenCalledOnce());
    expect(mocks.updateRankingAppearance.mock.calls[0][0]).toMatchObject({ contestId: '3' });
  });
});
