// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expectTypeOf } from 'vitest';
import en from '@/dictionaries/en.json';
import { toggleSubmissionOfficial } from '@/app/actions/submissions';
import type { SubmissionSummary } from '@/lib/evaluation-read-model-types';
import {
  SubmissionActionBar,
  type SubmissionActionEntry,
  type SubmissionActionBarProps,
} from '@/components/submissions/SubmissionActionBar';
import { SubmissionSummaryTab } from '@/components/submissions/SubmissionSummaryTab';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { buildRoute } from '@/lib/navigation/routes';

afterEach(() => cleanup());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/app/actions/submissions', () => ({
  recalculateSubmission: vi.fn(async () => ({ success: true })),
  toggleSubmissionOfficial: vi.fn(async () => ({ success: true })),
  updateSubmissionComment: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/app/actions/tasks', () => ({
  getTaskDatasets: vi.fn(async () => null),
}));

const ALL_ENTRIES: readonly SubmissionActionEntry[] = ['recompute', 'download', 'comment', 'official', 'lane'];

type Capabilities = SubmissionSummary['capabilities'];

const NO_CAPABILITIES: Capabilities = {
  canUpdate: false,
  canRecompute: false,
  canDownload: false,
  canMoveLane: false,
};

const ALL_CAPABILITIES: Capabilities = {
  canUpdate: true,
  canRecompute: true,
  canDownload: true,
  canMoveLane: true,
};

function renderBar(
  capabilities: Capabilities,
  entries: readonly SubmissionActionEntry[] = ALL_ENTRIES,
  extra: { lockHintKeys?: readonly string[] } = {},
): HTMLElement {
  const { container } = render(
    <DictionaryProvider dict={en}>
      <SubmissionActionBar
        submissionId={19}
        capabilities={capabilities}
        comment="needs review"
        official={false}
        entries={entries}
        taskId={3}
        {...extra}
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
    expect(container.textContent).not.toContain('Re-run');
  });

  it.each([
    ['canRecompute', 'Rescore'],
    ['canRecompute', 'Re-evaluate'],
    ['canRecompute', 'Re-run'],
    ['canDownload', 'Download files'],
    ['canUpdate', 'Edit comment'],
    ['canUpdate', 'Official off'],
    ['canMoveLane', 'Move lane'],
  ] as const)('hides the %s entry %s when only its flag is false', (capability, label) => {
    const container = renderBar({ ...ALL_CAPABILITIES, [capability]: false });
    expect(controlLabels(container)).not.toContain(label);
  });

  it('shows every entry point for a fully capable reader', () => {
    const labels = controlLabels(renderBar(ALL_CAPABILITIES));
    expect(labels).toContain('Rescore');
    expect(labels).toContain('Re-evaluate');
    expect(labels).toContain('Re-run');
    expect(labels).toContain('Download files');
    expect(labels).toContain('Edit comment');
    expect(labels).toContain('Official off');
    expect(labels).toContain('Move lane');
    expect(labels).not.toContain('Full Re-run');
  });

  it('opens the comment editor in a dialog rather than a prompt', () => {
    const container = renderBar(ALL_CAPABILITIES);
    const trigger = controlLabels(container).includes('Edit comment');
    expect(trigger).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain('window.prompt');
  });

  it('renders only the entries its owning surface asked for', () => {
    const labels = controlLabels(renderBar(ALL_CAPABILITIES, ['download']));
    expect(labels).toEqual(['Download files']);
  });
});

describe('SubmissionActionBar toolbar accessibility', () => {
  it('names the toolbar after the submission it acts on', () => {
    const toolbar = renderBar(ALL_CAPABILITIES).querySelector('[role="toolbar"]');
    expect(toolbar?.getAttribute('aria-label')).toBe('Submission #19 actions');
  });

  it('reserves an aria-hidden spinner slot in every pending-capable control so labels never shift', () => {
    const container = renderBar(ALL_CAPABILITIES);
    for (const label of ['Download files']) {
      const button = [...container.querySelectorAll('button')]
        .find((candidate) => candidate.textContent?.trim() === label);
      expect(button?.querySelector('span[aria-hidden="true"]'), label).not.toBeNull();
    }
    expect(container.querySelectorAll('.animate-spin')).toHaveLength(0);
  });

  it('keeps Full Re-run out of the segmented group and behind the Re-run menu', () => {
    renderBar(ALL_CAPABILITIES);
    const segmented = document.querySelector('.bg-muted');
    expect(segmented?.textContent).toContain('Rescore');
    expect(segmented?.textContent).toContain('Re-evaluate');
    expect(segmented?.textContent).not.toContain('Full Re-run');
    const trigger = screen.getByRole('button', { name: 'Re-run' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Full Re-run' })).not.toBeNull();
  });
});

describe('SubmissionActionBar official switch', () => {
  it('renders the stored state as an inline switch and calls the atomic action on toggle', async () => {
    renderBar(ALL_CAPABILITIES);

    const control = screen.getByRole('switch');
    expect(control.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(control);

    await waitFor(() => expect(toggleSubmissionOfficial).toHaveBeenCalledWith(19));
  });

  it('announces the state through the switch label itself', () => {
    renderBar(ALL_CAPABILITIES);
    expect(screen.getByRole('switch').textContent).toBe('Official off');
  });
});

describe('SubmissionActionBar lock hint', () => {
  it('names the missing keys of a partially granted capability group outside the toolbar', () => {
    const container = renderBar(ALL_CAPABILITIES, ALL_ENTRIES, {
      lockHintKeys: ['evaluation:delete', 'submissionresult:delete'],
    });

    expect(container.textContent).toContain('Read-only — you lack evaluation:delete, submissionresult:delete');
    expect(container.querySelector('[role="toolbar"]')?.textContent).not.toContain('Read-only');
  });

  it('stays silent without a partial grant', () => {
    const container = renderBar(ALL_CAPABILITIES, ALL_ENTRIES, { lockHintKeys: [] });
    expect(container.textContent).not.toContain('Read-only');
  });
});

describe('SubmissionActionBar entry/data coupling', () => {
  it('requires the comment and official data props once their entries appear', () => {
    expectTypeOf<SubmissionActionBarProps<readonly ['download', 'comment']>>().toMatchTypeOf<{ comment: string }>();
    expectTypeOf<SubmissionActionBarProps<readonly ['download', 'official']>>().toMatchTypeOf<{ official: boolean }>();
    expectTypeOf<SubmissionActionBarProps<readonly ['recompute', 'download', 'comment', 'official', 'lane']>>()
      .toMatchTypeOf<{ comment: string; official: boolean }>();
  });

  it('forbids the data props while the matching entry is absent', () => {
    expectTypeOf<SubmissionActionBarProps<readonly ['download']>>()
      .toMatchTypeOf<{ comment?: undefined; official?: undefined }>();
    expectTypeOf<SubmissionActionBarProps<readonly ['recompute', 'lane']>>()
      .toMatchTypeOf<{ comment?: undefined }>();
  });
});

const SUMMARY: SubmissionSummary = {
  id: 19,
  timestamp: '2026-02-03T04:05:06.000Z',
  language: 'cpp',
  comment: 'needs review',
  official: true,
  user: { id: 4, username: 'ada', firstName: 'Ada', lastName: 'Lovelace' },
  contest: { id: 2, name: 'Thailand Cup' },
  task: { id: 3, name: 'sum', title: 'Sum' },
  capabilities: NO_CAPABILITIES,
};

function renderSummary(permissionKeys: readonly string[]): HTMLElement {
  const { container } = render(
    <DictionaryProvider dict={en}>
      <SubmissionSummaryTab
        summary={SUMMARY}
        source={null}
        permissionKeys={permissionKeys}
        locale="en"
      />
    </DictionaryProvider>,
  );
  return container;
}

function anchorHrefs(container: HTMLElement): string[] {
  return [...container.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href') ?? '');
}

const COMPLETE_KEYS = ['submission:read', 'submissionresult:read', 'file:read', 'evaluation:read'];

describe('SubmissionSummaryTab tab links', () => {
  it('links to the outcome tabs a complete reader may open', () => {
    const hrefs = anchorHrefs(renderSummary(COMPLETE_KEYS));
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

  it('leaves the entity record links to the record header', () => {
    const hrefs = anchorHrefs(renderSummary(COMPLETE_KEYS));
    expect(hrefs).not.toContain(buildRoute('en', 'people.user-record', { id: 4 }));
    expect(hrefs).not.toContain(buildRoute('en', 'tasks.record', { id: 3 }));
    expect(hrefs).not.toContain(buildRoute('en', 'contests.record', { id: 2 }));
  });
});

describe('SubmissionSummaryTab status presentation', () => {
  it('shows no status card whose body is not a status', () => {
    expect(renderSummary(COMPLETE_KEYS).textContent).not.toContain('Detailed Status');
  });

  it('never runs a loader next to a static link', () => {
    expect(renderSummary(COMPLETE_KEYS).querySelectorAll('.animate-spin')).toHaveLength(0);
  });

  it('leaves the status derivation to the record header and the Results tab', () => {
    const container = renderSummary(COMPLETE_KEYS);
    for (const status of ['Compiling', 'Compilation Failed', 'Evaluating', 'Scoring', 'Done']) {
      expect(container.textContent, status).not.toContain(status);
    }
  });
});
