// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/en/ranking/users',
}));
vi.mock('@/app/actions/rankingConfig', () => ({
  endTarget: vi.fn(),
  showTarget: vi.fn(),
}));

import { RankingConfigSurface } from '@/components/ranking/RankingConfigSurface';
import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import { attributionText, isUnattributed } from '@/lib/ranking-attribution';
import type { ShownTarget } from '@/lib/ranking-config';

const COPY = en.ranking.shown;

/** A `ranking_config` row as the action maps it, with or without a recorded author. */
function shown(overrides: Partial<ShownTarget> = {}): ShownTarget {
  return {
    id: '4',
    kind: 'contest',
    key: '9',
    reason: 'day two',
    createdAt: '2026-10-16T01:00:00.000Z',
    createdBy: 3,
    createdByName: 'root',
    ...overrides,
  };
}

function renderRows(rows: readonly ShownTarget[]): HTMLElement {
  // `canShow` false keeps the read-only shape: the same list, without the form that writes.
  const { container } = render(
    <RankingConfigSurface copy={COPY} rows={rows} choices={[]} canShow={false} />,
  );
  return container;
}

afterEach(cleanup);

describe('the attribution decision on a config row', () => {
  it('reads a NULL author as written outside the panel, not as a missing field', () => {
    expect(isUnattributed({ createdBy: null })).toBe(true);
    expect(attributionText({ createdBy: null })).toBeNull();
  });

  it('keeps an id the name lookup could not resolve as an attribution', () => {
    const row = { createdBy: 7 };
    expect(isUnattributed(row)).toBe(false);
    expect(attributionText(row)).toBe('#7');
  });

  it('names the admin when the surface resolved one', () => {
    expect(isUnattributed({ createdBy: 3, createdByName: 'root' })).toBe(false);
    expect(attributionText({ createdBy: 3, createdByName: 'root' })).toBe('root');
  });
});

describe('the shown-config surface marks who showed each contest', () => {
  it('marks a config row written outside the panel', () => {
    const container = renderRows([
      shown({ id: '5', key: '7', createdBy: null, createdByName: null }),
    ]);

    expect(container.textContent).toContain(COPY.outsidePanelBadge);
  });

  it('shows the author of a config row the panel wrote', () => {
    const container = renderRows([shown({})]);

    expect(container.textContent).toContain('root');
    expect(container.textContent).not.toContain(COPY.outsidePanelBadge);
  });

  it('marks the unattributed row in a mixed list without marking the signed one', () => {
    const container = renderRows([
      shown({ id: '5', key: '7', createdBy: null, createdByName: null }),
      shown({ id: '6', key: '9', createdByName: 'ada' }),
    ]);

    expect(container.textContent?.split(COPY.outsidePanelBadge)).toHaveLength(2);
    expect(container.textContent).toContain('ada');
  });

  it('words the mark in Thai as well, so a Thai operator reads the same fact', () => {
    const { container } = render(
      <RankingConfigSurface
        copy={th.ranking.shown}
        rows={[shown({ createdBy: null, createdByName: null })]}
        choices={[]}
        canShow={false}
      />,
    );

    expect(th.ranking.shown.outsidePanelBadge).not.toBe('');
    expect(container.textContent).toContain(th.ranking.shown.outsidePanelBadge);
  });
});
