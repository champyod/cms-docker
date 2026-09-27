// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { DatasetsSection } from '@/components/tasks/task-detail-datasets';

afterEach(() => cleanup());

const TESTCASE_ID = 31;

function noop(): void {
  return undefined;
}

function renderTestcases(isPublic: boolean, onTogglePublic: (id: number) => void = noop): HTMLElement {
  render(
    <DatasetsSection
      datasets={[
        {
          id: 3,
          description: 'Live dataset',
          time_limit: 2,
          memory_limit: null,
          task_type: 'Batch',
          score_type: 'Sum',
          autojudge: false,
          task_type_parameters: {},
          score_type_parameters: {},
          testcases: [
            { id: TESTCASE_ID, codename: 'sample-01', public: isPublic },
            { id: 32, codename: 'hidden-02', public: !isPublic },
          ],
        },
      ]}
      activeDatasetId={3}
      expanded
      onToggle={noop}
      onCreate={noop}
      onEdit={noop}
      onActivate={noop}
      onClone={noop}
      onRename={noop}
      onToggleAutojudge={noop}
      onDelete={noop}
      onOpenTestcaseUpload={noop}
      onDeleteTestcase={noop}
      onTogglePublic={onTogglePublic}
      locale="en"
      docsLinkLabel="View Documentation"
    />,
  );
  return screen.getByRole('button', { name: isPublic ? 'Make testcase private' : 'Make testcase public' });
}

/** Why the class check and not a computed style: the touch target lives in the emitted utility, and no stylesheet loads in this environment. */
function expectTouchTarget(button: HTMLElement): void {
  const isSquare11 = button.className.includes('h-11') && button.className.includes('w-11');
  expect(isSquare11 || button.className.includes('size-11')).toBe(true);
}

describe('testcase visibility toggle', () => {
  it('names the control with the action it performs', () => {
    const toggle = renderTestcases(false);
    expect(toggle.getAttribute('aria-label')).toBe('Make testcase public');
    cleanup();
    expect(renderTestcases(true).getAttribute('aria-label')).toBe('Make testcase private');
  });

  // Why textContent and not the accessible name: a bare letter is announced as
  // the name yet reads as the whole control on screen, so the glyph itself must
  // be gone from the button's rendered text.
  it('shows no bare letter in place of an icon', () => {
    expect(renderTestcases(false).textContent).toBe('');
    expect(screen.queryByRole('button', { name: 'H' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'P' })).toBeNull();
  });

  it('distinguishes the two states with an icon', () => {
    expect(renderTestcases(false).querySelector('.lucide-lock')).not.toBeNull();
    cleanup();
    expect(renderTestcases(true).querySelector('.lucide-globe')).not.toBeNull();
  });

  it('carries a tooltip, so the glyph is never the only cue', () => {
    expect(renderTestcases(false).getAttribute('data-slot')).toBe('tooltip-trigger');
  });

  it('keeps the 44px target and the state colour on both states', () => {
    const privateToggle = renderTestcases(false);
    expectTouchTarget(privateToggle);
    expect(privateToggle.className).toContain('text-muted-foreground');
    cleanup();
    const publicToggle = renderTestcases(true);
    expectTouchTarget(publicToggle);
    expect(publicToggle.className).toContain('text-success');
  });

  it('still toggles the same testcase on click', () => {
    const onTogglePublic = vi.fn();
    fireEvent.click(renderTestcases(false, onTogglePublic));
    expect(onTogglePublic).toHaveBeenCalledTimes(1);
    expect(onTogglePublic).toHaveBeenCalledWith(TESTCASE_ID);
  });
});
