// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import en from '@/dictionaries/en.json';
import { RankingDiagnosticsCard } from '@/components/ranking/RankingDiagnosticsCard';
import type { RankingDiagnostics } from '@/lib/ranking-diagnostics';

// Why: globals are off in vitest.config.ts, so without this a later render would find the
// accumulated document.body.
afterEach(() => cleanup());

const copy = en.ranking.diagnostics;

function reportable(overrides: Partial<Extract<RankingDiagnostics, { reachable: true }>> = {}) {
  return {
    reachable: true,
    skippedOverrides: 2,
    skippedSubchanges: 9,
    subchangeCauses: {
      hiddenTaskSubchanges: 4,
      unknownTaskSubchanges: 3,
      orphanSubchanges: 2,
    },
    hideCauses: {
      unknownTaskHides: 3,
      withheldTaskHides: 1,
      renamedTaskHides: 1,
      unmatchedTaskHides: 1,
    },
    ...overrides,
  } as const satisfies Extract<RankingDiagnostics, { reachable: true }>;
}

describe('RankingDiagnosticsCard', () => {
  // The item's own words: "surface all four hide counters in the panel". Until this card they
  // shipped from /diagnostics and reached nobody, so an operator could not tell a hide of their
  // own from a data fault without reading the service's logs.
  it('draws all four task-hide counters', () => {
    render(<RankingDiagnosticsCard diagnostics={reportable()} copy={copy} />);

    expect(screen.getByText(copy.unknownTaskHides)).toBeTruthy();
    expect(screen.getByText(copy.withheldTaskHides)).toBeTruthy();
    expect(screen.getByText(copy.renamedTaskHides)).toBeTruthy();
    expect(screen.getByText(copy.unmatchedTaskHides)).toBeTruthy();
    for (const value of ['3', '1']) {
      expect(screen.getAllByText(value).length).toBeGreaterThan(0);
    }
  });

  it('draws the dropped-row total beside its three causes', () => {
    render(<RankingDiagnosticsCard diagnostics={reportable()} copy={copy} />);

    expect(screen.getByText(copy.subchangeTotal)).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText(copy.hiddenTaskSubchanges)).toBeTruthy();
    expect(screen.getByText(copy.unknownTaskSubchanges)).toBeTruthy();
    expect(screen.getByText(copy.orphanSubchanges)).toBeTruthy();
    expect(screen.getByText(copy.overridesLabel)).toBeTruthy();
  });

  // The alarm the breakdown exists for: rows dropped for a reason no hide explains. Its count is
  // the two fault causes, not the total, or the operator's own hide would keep it lit forever.
  it('raises the fault alarm over the fault causes only', () => {
    render(<RankingDiagnosticsCard diagnostics={reportable()} copy={copy} />);

    expect(
      screen.getByText(copy.faultAlert.replace('{count}', '5')),
    ).toBeTruthy();
  });

  it('stays quiet when every cause is zero', () => {
    render(
      <RankingDiagnosticsCard
        diagnostics={reportable({
          skippedSubchanges: 0,
          subchangeCauses: {
            hiddenTaskSubchanges: 0,
            unknownTaskSubchanges: 0,
            orphanSubchanges: 0,
          },
          hideCauses: {
            unknownTaskHides: 0,
            withheldTaskHides: 0,
            renamedTaskHides: 0,
            unmatchedTaskHides: 0,
          },
        })}
        copy={copy}
      />,
    );

    expect(screen.queryByText(copy.faultAlert.replace('{count}', '0'))).toBeNull();
    expect(screen.queryByText(copy.hideAlert.replace('{count}', '0'))).toBeNull();
    // The counters stay drawn at zero: a quiet card cannot tell "nothing was dropped" from
    // "nobody measured it".
    expect(screen.getByText(copy.subchangeTotal)).toBeTruthy();
    expect(screen.getByText(copy.unknownTaskHides)).toBeTruthy();
  });

  it('raises the stale-hide alarm for a hide that no longer matches a task', () => {
    render(
      <RankingDiagnosticsCard
        diagnostics={reportable({
          hideCauses: {
            unknownTaskHides: 2,
            withheldTaskHides: 0,
            renamedTaskHides: 2,
            unmatchedTaskHides: 0,
          },
        })}
        copy={copy}
      />,
    );

    expect(screen.getByText(copy.hideAlert.replace('{count}', '2'))).toBeTruthy();
  });

  // A service that predates the breakdown must read as "not reported", never as a clean board.
  it('renders an unreported breakdown as not measured rather than as zeros', () => {
    render(
      <RankingDiagnosticsCard
        diagnostics={reportable({ subchangeCauses: null, hideCauses: null })}
        copy={copy}
      />,
    );

    expect(screen.getAllByText(copy.notReported)).toHaveLength(2);
    expect(screen.queryByText(copy.unknownTaskHides)).toBeNull();
  });

  it('reports an unreachable service as its own warning, never as zero counters', () => {
    render(
      <RankingDiagnosticsCard
        diagnostics={{ reachable: false, reason: 'HTTP 503' }}
        copy={copy}
      />,
    );

    expect(screen.getByText(copy.unreachable.replace('{reason}', 'HTTP 503'))).toBeTruthy();
    expect(screen.queryByText(copy.subchangeTotal)).toBeNull();
  });
});
