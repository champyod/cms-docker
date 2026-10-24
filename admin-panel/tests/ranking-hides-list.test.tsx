// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { RankingHidesList } from '@/components/ranking/RankingHidesList';
import en from '@/dictionaries/en.json';
import type { RankingHide } from '@/lib/ranking-hides';

const COPY = en.ranking;
const HIDES = COPY.hides;

function hide(overrides: Partial<RankingHide>): RankingHide {
  return {
    id: 'user:ada',
    targetKind: 'user',
    targetKey: 'ada',
    label: 'Ada Lovelace',
    sources: [{ source: 'override', reason: 'test account', createdBy: 3, createdByName: 'root' }],
    ...overrides,
  };
}

afterEach(cleanup);

describe('ranking hides list', () => {
  it('names the hidden row the way the board does', () => {
    const { container } = render(<RankingHidesList copy={COPY} hides={[hide({})]} />);

    expect(container.textContent).toContain('Ada Lovelace');
    expect(container.textContent).toContain(HIDES.sourceOverride);
    expect(container.textContent).toContain('root');
    expect(container.textContent).toContain('test account');
  });

  it('marks a hide whose target the board no longer has', () => {
    const { container } = render(
      <RankingHidesList copy={COPY} hides={[hide({ label: null, targetKey: 'ghost' })]} />,
    );

    expect(container.textContent).toContain('ghost');
    expect(container.textContent).toContain(HIDES.unknownTarget);
  });

  it('marks a hide nobody signed, because that is the write the panel never made', () => {
    const { container } = render(
      <RankingHidesList
        copy={COPY}
        hides={[
          hide({
            sources: [{ source: 'override', reason: 'filed by hand', createdBy: null, createdByName: null }],
          }),
        ]}
      />,
    );

    expect(container.textContent).toContain(COPY.overrides.outsidePanelBadge);
  });

  it('reports a hidden participation as its own source', () => {
    const { container } = render(
      <RankingHidesList
        copy={COPY}
        hides={[hide({ sources: [{ source: 'participation' }], label: null, targetKey: 'bob' })]}
      />,
    );

    expect(container.textContent).toContain(HIDES.sourceParticipation);
    expect(container.textContent).toContain('bob');
  });

  it('lists both writers when they hide the same row', () => {
    const { container } = render(
      <RankingHidesList
        copy={COPY}
        hides={[
          hide({
            sources: [
              { source: 'override', reason: 'test account', createdBy: 3, createdByName: 'root' },
              { source: 'participation' },
            ],
          }),
        ]}
      />,
    );

    expect(container.textContent).toContain(HIDES.sourceOverride);
    expect(container.textContent).toContain(HIDES.sourceParticipation);
  });

  it('says the board hides nothing rather than drawing an empty table', () => {
    const { container } = render(<RankingHidesList copy={COPY} hides={[]} />);

    expect(container.textContent).toContain(HIDES.empty);
  });
});
