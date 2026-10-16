// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getRankingImpact: vi.fn(),
  searchRankingTargets: vi.fn(async () => []),
  saveRankingOverride: vi.fn(),
  endRankingOverrides: vi.fn(async () => undefined),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/en/ranking/users',
}));
vi.mock('@/app/actions/ranking', () => ({
  getRankingImpact: mocks.getRankingImpact,
  searchRankingTargets: mocks.searchRankingTargets,
}));
vi.mock('@/app/actions/rankingOverrides', () => ({
  saveRankingOverride: mocks.saveRankingOverride,
  endRankingOverrides: mocks.endRankingOverrides,
}));

import { RankingImpactDiff } from '@/components/ranking/RankingImpactDiff';
import { RankingOverrideList } from '@/components/ranking/RankingOverrideList';
import { RankingOverrideSurface } from '@/components/ranking/RankingOverrideSurface';
import en from '@/dictionaries/en.json';

type OverrideRow = Parameters<typeof RankingOverrideList>[0]['rows'][number];

const COPY = en.ranking.overrides;
const EMPTY_IMPACT = { columns: [], users: [], teams: [], scopeMismatch: false, unknownTarget: false };

function override(overrides: Partial<OverrideRow>): OverrideRow {
  return {
    id: '1',
    contestId: 9,
    targetKind: 'user',
    targetKey: 'ada',
    action: 'hide',
    value: '',
    reason: 'test account',
    createdAt: '2026-10-15T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ranking override surface shape', () => {
  it('pins the kind chooser as the toolbar beside the impact column', () => {
    const { container } = render(
      <RankingOverrideSurface
        copy={COPY}
        contestId={9}
        targetKind="user"
        targetKey=""
        userKeys={[{ key: 'ada', label: 'Ada Lovelace' }]}
        teamKeys={[]}
        contestKeys={[]}
        taskKeys={[]}
      />,
    );

    expect(container.querySelector('#ranking-override-kind')).not.toBeNull();
    expect(container.textContent).toContain(COPY.impactTitle);
  });

  it('reads the board impact once a target is picked', async () => {
    mocks.getRankingImpact.mockResolvedValue({ ...EMPTY_IMPACT, users: ['Ada Lovelace'] });
    const { container } = render(
      <RankingOverrideSurface
        copy={COPY}
        contestId={9}
        targetKind="user"
        targetKey=""
        userKeys={[{ key: 'ada', label: 'Ada Lovelace' }]}
        teamKeys={[]}
        contestKeys={[]}
        taskKeys={[]}
      />,
    );

    const input = container.querySelector<HTMLInputElement>('#ranking-override-target');
    if (input === null) throw new Error('the combobox is missing');
    fireEvent.focus(input);
    const option = container.querySelector<HTMLLIElement>('#ranking-override-target-listbox li[role="option"]');
    if (option === null) throw new Error('the dropdown listed no option');
    fireEvent.click(option);

    await waitFor(
      () => expect(mocks.getRankingImpact).toHaveBeenCalledWith(9, 'user', 'ada'),
      { timeout: 2000 },
    );
    await waitFor(() => expect(container.textContent).toContain('Ada Lovelace'), { timeout: 2000 });
  });
});

describe('ranking impact column', () => {
  it('lists the board entities the pending row changes', () => {
    const { container } = render(
      <RankingImpactDiff
        copy={COPY}
        impact={{ ...EMPTY_IMPACT, columns: ['aplusb'], users: ['Ada Lovelace'], teams: ['Alpha'] }}
        loading={false}
      />,
    );

    expect(container.textContent).toContain('aplusb');
    expect(container.textContent).toContain('Ada Lovelace');
    expect(container.textContent).toContain('Alpha');
  });

  it('says so when the pending row changes nothing yet', () => {
    const { container } = render(<RankingImpactDiff copy={COPY} impact={null} loading={false} />);

    expect(container.textContent).toContain(COPY.impactEmpty);
  });

  it('names the silent no-op when the key names another contest', () => {
    const { container } = render(
      <RankingImpactDiff
        copy={COPY}
        impact={{ ...EMPTY_IMPACT, scopeMismatch: true }}
        loading={false}
      />,
    );

    expect(container.textContent).toContain(COPY.impactScopeMismatch);
  });
});

describe('ranking override list', () => {
  it('marks the row no enabled binding serves', () => {
    const { container } = render(
      <RankingOverrideList
        copy={COPY}
        rows={[override({ id: '1', contestId: 9 }), override({ id: '2', contestId: 3 })]}
        orphanContestIds={[3]}
        canOverride
      />,
    );

    // The responsive table draws the desktop row and the mobile card, so the row that carries the
    // badge is asked for by its own text rather than by a global count.
    const rows = [...container.querySelectorAll('table tbody tr')];
    const orphanRows = rows.filter((row) => row.textContent?.includes(COPY.orphanBadge));
    expect(orphanRows).toHaveLength(1);
    expect(orphanRows[0].textContent).toContain('3');
  });

  it('narrows the rows by the search term', () => {
    const { container } = render(
      <RankingOverrideList
        copy={COPY}
        rows={[
          override({ id: '1', targetKey: 'ada', reason: 'test account' }),
          override({ id: '2', targetKey: 'bob', reason: 'preserve account' }),
        ]}
        orphanContestIds={[]}
        canOverride
      />,
    );

    const search = container.querySelector<HTMLInputElement>('#ranking-override-filter-search');
    if (search === null) throw new Error('the filter search is missing');
    fireEvent.change(search, { target: { value: 'preserve' } });

    const desktop = container.querySelector('table tbody');
    expect(desktop?.textContent).toContain('bob');
    expect(desktop?.textContent).not.toContain('ada');
  });

  it('offers a select-all box on the header cell', () => {
    const { container } = render(
      <RankingOverrideList copy={COPY} rows={[override({})]} orphanContestIds={[]} canOverride />,
    );

    expect(container.querySelector(`input[aria-label="${COPY.selectAll}"]`)).not.toBeNull();
  });
});
