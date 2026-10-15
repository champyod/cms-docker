// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import type { SubmissionHistoryEntry, SubmissionHistoryResult } from '@/app/actions/audit';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { SubmissionHistoryTab } from '@/components/submissions/SubmissionHistoryTab';
import en from '@/dictionaries/en.json';

afterEach(() => cleanup());

const ENTRY: SubmissionHistoryEntry = {
  id: '1',
  actor_id: 7,
  actor_name: 'root',
  timestamp: '2026-02-03T04:05:06.000Z',
  verb: 'submission:update',
  result: 'success',
  reason: 'checker fix',
  before_values: null,
  after_values: null,
};

function renderTab(history: SubmissionHistoryResult): HTMLElement {
  const { container } = render(
    <DictionaryProvider dict={en}>
      <SubmissionHistoryTab submissionId={19} history={history} />
    </DictionaryProvider>,
  );
  return container;
}

describe('SubmissionHistoryTab', () => {
  it('lists each recorded change under the record label with the localized field names', () => {
    const container = renderTab({ success: true, data: [ENTRY] });

    expect(container.textContent).toContain('History — Submission #19');
    expect(container.textContent).toContain(en.submissions.record.history.actor + ': root');
    expect(container.textContent).toContain(en.submissions.record.history.action + ': submission:update');
    expect(container.textContent).toContain(en.submissions.record.history.result + ': success');
    expect(container.textContent).toContain(en.submissions.record.history.reason + ': checker fix');
  });

  it('states that nothing is recorded yet on an empty history', () => {
    const container = renderTab({ success: true, data: [] });

    expect(container.textContent).toContain(en.submissions.history.empty);
  });

  it('surfaces a failed history read instead of an empty list', () => {
    const container = renderTab({ success: false, error: 'Missing audit:list permission' });

    expect(container.textContent).toContain('Missing audit:list permission');
    expect(container.textContent).not.toContain(en.submissions.history.empty);
  });
});
