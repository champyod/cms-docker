// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import en from '@/dictionaries/en.json';
import type { SubmissionSummary } from '@/lib/evaluation-read-model-types';
import { SubmissionActionBar, type SubmissionActionEntry } from '@/components/submissions/SubmissionActionBar';
import { SubmissionSummaryTab } from '@/components/submissions/SubmissionSummaryTab';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';

afterEach(() => cleanup());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

const ALL_ENTRIES: readonly SubmissionActionEntry[] = ['recompute', 'download', 'comment', 'official', 'lane'];

type Capabilities = SubmissionSummary['capabilities'];

const NO_CAPABILITIES: Capabilities = {
  canUpdate: false,
  canRecompute: false,
  canDownload: false,
  canAssignLane: false,
  canMoveLane: false,
};

const ALL_CAPABILITIES: Capabilities = {
  canUpdate: true,
  canRecompute: true,
  canDownload: true,
  canAssignLane: true,
  canMoveLane: true,
};

function renderBar(capabilities: Capabilities, entries: readonly SubmissionActionEntry[] = ALL_ENTRIES): HTMLElement {
  const { container } = render(
    <DictionaryProvider dict={en}>
      <SubmissionActionBar
        submissionId={19}
        capabilities={capabilities}
        comment="needs review"
        official={false}
        entries={entries}
        navigation={en.navigation}
      />
    </DictionaryProvider>,
  );
  return container;
}

function controlLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('button')]
    .map((button) => button.textContent?.trim() ?? '')
    .filter((label) => label.length > 0);
}

describe('SubmissionActionBar capability gating', () => {
  it('hides every entry point when no capability flag is granted', () => {
    const container = renderBar(NO_CAPABILITIES);
    expect(controlLabels(container)).toEqual([]);
    expect(container.textContent).not.toContain('Rescore');
    expect(container.textContent).not.toContain('Download files');
    expect(container.textContent).not.toContain('Move lane');
  });

  it.each([
    ['canRecompute', 'Rescore'],
    ['canRecompute', 'Re-evaluate'],
    ['canRecompute', 'Full Re-run'],
    ['canDownload', 'Download files'],
    ['canUpdate', 'Edit comment'],
    ['canUpdate', 'Mark official'],
    ['canMoveLane', 'Move lane'],
  ] as const)('hides the %s entry %s when only its flag is false', (capability, label) => {
    const container = renderBar({ ...ALL_CAPABILITIES, [capability]: false });
    expect(controlLabels(container)).not.toContain(label);
  });

  it('shows every entry point for a fully capable reader', () => {
    const labels = controlLabels(renderBar(ALL_CAPABILITIES));
    expect(labels).toContain('Rescore');
    expect(labels).toContain('Re-evaluate');
    expect(labels).toContain('Full Re-run');
    expect(labels).toContain('Download files');
    expect(labels).toContain('Edit comment');
    expect(labels).toContain('Move lane');
  });

  it('opens the comment editor in a dialog rather than a prompt', () => {
    const container = renderBar(ALL_CAPABILITIES);
    const trigger = controlLabels(container).includes('Edit comment');
    expect(trigger).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain('window.prompt');
  });

  it('renders only the entries its owning tab asked for', () => {
    const labels = controlLabels(renderBar(ALL_CAPABILITIES, ['download']));
    expect(labels).toEqual(['Download files']);
  });
});

const SUMMARY: SubmissionSummary = {
  id: 19,
  timestamp: '2026-02-03T04:05:06.000Z',
  language: 'cpp',
  comment: 'needs review',
  official: true,
  user: { id: 4, username: 'ada' },
  contest: { id: 2, name: 'Thailand Cup' },
  task: { id: 3, name: 'sum', title: 'Sum' },
  capabilities: NO_CAPABILITIES,
};

function renderSummary(permissionKeys: readonly string[]): HTMLElement {
  const { container } = render(
    <DictionaryProvider dict={en}>
      <SubmissionSummaryTab
        summary={SUMMARY}
        permissionKeys={permissionKeys}
        navigation={en.navigation}
        locale="en"
      />
    </DictionaryProvider>,
  );
  return container;
}

function anchorHrefs(container: HTMLElement): string[] {
  return [...container.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href') ?? '');
}

describe('SubmissionSummaryTab tab links', () => {
  it('links to the outcome tabs a complete reader may open', () => {
    const hrefs = anchorHrefs(renderSummary(['submission:read', 'submissionresult:read', 'file:read', 'evaluation:read']));
    expect(hrefs).toContain('/en/evaluation/submissions/19/results');
    expect(hrefs).toContain('/en/evaluation/submissions/19/evaluation');
  });

  it.each([
    [['submission:read', 'evaluation:read'], '/en/evaluation/submissions/19/results'],
    [['submission:read', 'submissionresult:read', 'file:read'], '/en/evaluation/submissions/19/evaluation'],
    [['submission:read'], '/en/evaluation/submissions/19/results'],
  ])('omits the outcome link the reader set %s cannot open', (permissionKeys, forbiddenHref) => {
    expect(anchorHrefs(renderSummary(permissionKeys))).not.toContain(forbiddenHref);
  });
});
