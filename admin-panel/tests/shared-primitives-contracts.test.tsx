// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Pencil, Trash2, Upload } from 'lucide-react';

import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import { ConfirmDialog } from '@/components/core/ConfirmDialog';
import { InlineAlert } from '@/components/core/InlineAlert';
import { ModalFooter } from '@/components/core/ModalFooter';
import { RowActions, ROW_ACTION_GROUP_TYPES, rowActionGroupLabel, type RowAction } from '@/components/core/RowActions';
import { RowFreshness } from '@/components/core/RowFreshness';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { rowFreshness } from '@/lib/live/row-freshness';

afterEach(() => cleanup());

function textOf(element: Element | null): string {
  return element?.textContent ?? '';
}

function isDisabled(element: Element): boolean {
  return element instanceof HTMLButtonElement && element.disabled;
}

const EDIT_DELETE: readonly RowAction[] = [
  { key: 'edit', label: 'Edit', icon: Pencil, onClick: () => undefined },
  { key: 'delete', label: 'Delete', icon: Trash2, onClick: () => undefined, variant: 'negativeOutline' },
];

describe('ModalFooter variant and slot contracts', () => {
  it('defaults both variants to the hand-authored ghost cancel and positive confirm', () => {
    const { container } = render(<ModalFooter cancelLabel="Cancel" confirmLabel="Save" onCancel={() => undefined} onConfirm={() => undefined} />);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Save' });
    expect(cancel.className).toContain('hover:bg-accent');
    expect(cancel.className).not.toContain('border-destructive');
    expect(confirm.className).toContain('bg-primary');
    expect(container.querySelectorAll('button')).toHaveLength(2);
  });

  it('repaints the confirm when the dialog confirms destructively', () => {
    const { container } = render(<ModalFooter cancelLabel="Cancel" confirmLabel="Delete" confirmVariant="negative" onCancel={() => undefined} onConfirm={() => undefined} />);
    const confirm = container.querySelectorAll('button')[1];
    expect(confirm.className).toContain('destructive');
    expect(confirm.className).not.toContain('bg-primary');
  });

  it('repaints the cancel when the dialog dismisses destructively', () => {
    const { container } = render(<ModalFooter cancelLabel="Discard" cancelVariant="negativeOutline" confirmLabel="Save" onCancel={() => undefined} onConfirm={() => undefined} />);
    const cancel = container.querySelectorAll('button')[0];
    expect(cancel.className).toContain('destructive');
    expect(cancel.className).not.toContain('hover:bg-accent');
  });

  it('leads the row with a confirm icon beside the label', () => {
    const { container } = render(<ModalFooter cancelLabel="Cancel" confirmLabel="Upload" confirmIcon={Upload} onCancel={() => undefined} onConfirm={() => undefined} />);
    const confirm = container.querySelectorAll('button')[1];
    expect(textOf(confirm)).toBe('Upload');
    expect(confirm.querySelector('svg')).not.toBeNull();
  });

  it('adds a row class without dropping the layout classes', () => {
    const { container } = render(<ModalFooter className="mt-4 border-t border-border" cancelLabel="Cancel" confirmLabel="Save" onCancel={() => undefined} onConfirm={() => undefined} />);
    const row = container.querySelector('[data-footer-layout="end"]');
    expect(row?.className).toContain('justify-end');
    expect(row?.className).toContain('mt-4');
    expect(row?.className).toContain('border-t');
  });

  it('renders a third control ahead of cancel and fires it', () => {
    const onReset = vi.fn();
    const { container } = render(<ModalFooter leadingAction={<button type="button" onClick={onReset}>Reset</button>} cancelLabel="Cancel" confirmLabel="Save" onCancel={() => undefined} onConfirm={() => undefined} />);
    expect(Array.from(container.querySelectorAll('button')).map((button) => textOf(button))).toEqual(['Reset', 'Cancel', 'Save']);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('renders no confirm button when the dialog has no confirm action', () => {
    const onConfirm = vi.fn();
    const { container } = render(<ModalFooter cancelLabel="Close" onCancel={() => undefined} onConfirm={onConfirm} />);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Close' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('locks pending cancellation with the confirm unless the dialog opts out', () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <ModalFooter
        leadingAction={<button type="button">Reset</button>}
        cancelLabel="Cancel"
        confirmLabel="Save"
        onCancel={onCancel}
        onConfirm={() => undefined}
        confirmLoading
      />,
    );
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(isDisabled(cancel)).toBe(true);
    fireEvent.click(cancel);
    expect(onCancel).not.toHaveBeenCalled();

    rerender(
      <ModalFooter
        leadingAction={<button type="button">Reset</button>}
        cancelLabel="Cancel"
        confirmLabel="Save"
        onCancel={onCancel}
        onConfirm={() => undefined}
        confirmLoading
        cancelDisabled={false}
      />,
    );
    const reachable = screen.getByRole('button', { name: 'Cancel' });
    expect(isDisabled(reachable)).toBe(false);
    fireEvent.click(reachable);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('InlineAlert density and title contracts', () => {
  it('defaults to the titled page alert it renders today', () => {
    const { container } = render(<InlineAlert tone="warning" title="Unsaved changes">Review before leaving.</InlineAlert>);
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('p-4');
    expect(alert.className).toContain('text-sm');
    expect(alert.className).toContain('border-warning/30');
    expect(container.querySelector('p')?.className).toContain('text-warning');
    expect(container.querySelector('p')?.textContent).toBe('Unsaved changes');
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('size-5');
  });

  it('drops the title when the whole message is the body', () => {
    const { container } = render(<InlineAlert tone="destructive">Container restart failed.</InlineAlert>);
    expect(screen.getByRole('alert').textContent).toBe('Container restart failed.');
    expect(container.querySelector('p')).toBeNull();
  });

  it('scales a compact strip to the dense note it replaces', () => {
    const { container } = render(<InlineAlert tone="warning" density="compact">Container will NOT restart automatically on failure.</InlineAlert>);
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('p-3');
    expect(alert.className).toContain('text-xs');
    expect(alert.className).toContain('border-warning/20');
    expect(alert.className).toContain('gap-1.5');
    expect(alert.className).not.toContain('p-4');
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('size-3.5');
  });

  it('tones the body at compact and mutes it at default', () => {
    function bodyClass(): string {
      return screen.getByRole('alert').querySelector('.min-w-0 > div')?.className ?? '';
    }
    const { unmount } = render(<InlineAlert tone="warning" density="compact">Body copy.</InlineAlert>);
    expect(bodyClass()).toContain('text-warning');
    unmount();
    render(<InlineAlert tone="warning" title="Title">Body copy.</InlineAlert>);
    expect(bodyClass()).toContain('text-foreground/80');
  });
});

describe('RowAction per-action contracts', () => {
  it('names an action per record without restating it in the tooltip', () => {
    render(<RowActions ariaLabel={rowActionGroupLabel(en, 'contests')} actions={[
      { key: 'edit', label: 'Edit', ariaLabel: 'Edit Contest 4', icon: Pencil, onClick: () => undefined },
    ]} />);
    const edit = screen.getByRole('button', { name: 'Edit Contest 4' });
    expect(edit.getAttribute('aria-label')).toBe('Edit Contest 4');
    expect(edit.getAttribute('title')).toBeNull();
  });

  it('falls back to the label as the accessible name when no per-record name is given', () => {
    render(<RowActions ariaLabel="Contest actions" actions={EDIT_DELETE} />);
    expect(screen.getByRole('button', { name: 'Edit' }).getAttribute('aria-label')).toBe('Edit');
    expect(screen.getByRole('button', { name: 'Delete' }).getAttribute('aria-label')).toBe('Delete');
  });

  it('keeps a per-action hover tint on the button it belongs to', () => {
    render(<RowActions ariaLabel="Task actions" actions={[
      { key: 'edit', label: 'Edit', icon: Pencil, onClick: () => undefined, className: 'hover:text-primary' },
      { key: 'delete', label: 'Delete', icon: Trash2, onClick: () => undefined, className: 'hover:text-destructive' },
    ]} />);
    expect(screen.getByRole('button', { name: 'Edit' }).className).toContain('hover:text-primary');
    expect(screen.getByRole('button', { name: 'Edit' }).className).not.toContain('hover:text-destructive');
    expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('hover:text-destructive');
  });

  it('maps every list type to a non-empty label in both locales', () => {
    for (const listType of ROW_ACTION_GROUP_TYPES) {
      for (const dictionary of [en, th] as const) {
        expect(rowActionGroupLabel(dictionary, listType).trim(), listType).not.toBe('');
      }
    }
    expect(rowActionGroupLabel(en, 'admins')).toBe(en.rowActions.admins);
    expect(rowActionGroupLabel(th, 'users')).toBe(th.rowActions.users);
    expect(rowActionGroupLabel(en, 'users')).not.toBe(rowActionGroupLabel(th, 'users'));
  });
});

describe('RowActions primary marker contracts', () => {
  it('marks the named action and no other', () => {
    render(<RowActions ariaLabel="User actions" primaryActionKey="delete" actions={EDIT_DELETE} />);
    expect(screen.getByRole('button', { name: 'Delete' }).getAttribute('data-shortcut-primary')).toBe('true');
    expect(screen.getByRole('button', { name: 'Edit' }).hasAttribute('data-shortcut-primary')).toBe(false);
  });

  it('marks nothing when no key is given', () => {
    render(<RowActions ariaLabel="Task actions" actions={EDIT_DELETE} />);
    for (const action of EDIT_DELETE) expect(screen.getByRole('button', { name: action.label }).hasAttribute('data-shortcut-primary')).toBe(false);
  });

  // Why the throw: a key matching nothing disables the j/k shortcut silently, so a typo has to
  // surface at the call site instead of degrading the keyboard path.
  it('fails loudly when the key names no action rather than marking nothing', () => {
    expect(() => render(<RowActions ariaLabel="User actions" primaryActionKey="archive" actions={EDIT_DELETE} />))
      .toThrow(/primaryActionKey "archive" matches no action/);
  });
});

describe('dictionary provider contract', () => {
  // Why this rides on a core consumer: the throw belongs to the hook, and a consumer is the only
  // way to call a hook under test, so the contract is pinned on whichever core component still
  // reads the dictionary rather than on a fixture that could drift from real usage.
  it('fails closed without a dictionary instead of falling back to English', () => {
    expect(() => render(<ConfirmDialog confirmation={null} onResolve={() => undefined} />)).toThrow(/DictionaryProvider/);
  });
});

/**
 * The one per-row freshness cue, pinned on its rule and on what it renders.
 *
 * Why this rides on the shared primitives: every row surface (containers, workers, resources, and any
 * later one) marks its rows through this component and this predicate, so the contract here is what
 * keeps five surfaces from drifting into five different ideas of "stale".
 */
const EARLIER = '2026-10-16T11:58:00.000Z';
const LATER = '2026-10-16T12:00:00.000Z';

describe('row freshness rule contracts', () => {
  it('keeps a row from the same read as its surface fresh, which is what an unchanged surface looks like', () => {
    expect(rowFreshness({ readAt: LATER, surfaceReadAt: LATER, streamStatus: 'live' })).toBe('fresh');
  });

  // Why strictly older: a row can never be newer than the read its surface was told about, and reading
  // that as stale would mark rows the moment a surface moved on to a newer read.
  it('does not mark a row from a later read than the surface states', () => {
    expect(rowFreshness({ readAt: LATER, surfaceReadAt: EARLIER, streamStatus: 'live' })).toBe('fresh');
  });

  it('marks a row whose own read predates the newest read its surface holds', () => {
    expect(rowFreshness({ readAt: EARLIER, surfaceReadAt: LATER, streamStatus: 'live' })).toBe('stale');
  });

  // Why the stream's own state is in the rule: a dropped stream and an unchanged one deliver exactly
  // the same thing — nothing — so without it the two states could not be told apart at all.
  it('marks a dated row while the stream is reconnecting, whatever the surface last stated', () => {
    expect(rowFreshness({ readAt: EARLIER, surfaceReadAt: LATER, streamStatus: 'reconnecting' })).toBe('stale');
    expect(rowFreshness({ readAt: EARLIER, surfaceReadAt: EARLIER, streamStatus: 'reconnecting' })).toBe('stale');
  });

  // Why a paused channel does not mark: the panel stopped it on purpose while nobody was looking, and
  // the reconnect restores a fresh snapshot. `connecting` has no rows of its own to date.
  it('leaves the rows alone while the tab is hidden or the channel has not opened', () => {
    expect(rowFreshness({ readAt: LATER, surfaceReadAt: LATER, streamStatus: 'paused' })).toBe('fresh');
    expect(rowFreshness({ readAt: LATER, surfaceReadAt: LATER, streamStatus: 'connecting' })).toBe('fresh');
  });

  it('reports unknown rather than fresh when nothing can date the row', () => {
    expect(rowFreshness({ readAt: null, surfaceReadAt: LATER, streamStatus: 'live' })).toBe('unknown');
    expect(rowFreshness({ readAt: EARLIER, surfaceReadAt: null, streamStatus: 'live' })).toBe('unknown');
    expect(rowFreshness({ readAt: 'not a date', surfaceReadAt: LATER, streamStatus: 'live' })).toBe('unknown');
    expect(rowFreshness({ readAt: EARLIER, surfaceReadAt: 'not a date', streamStatus: 'live' })).toBe('unknown');
  });
});

describe('RowFreshness render contracts', () => {
  function renderCue(props: { readAt: string | null; surfaceReadAt: string | null; streamStatus: 'live' | 'reconnecting' }): HTMLElement {
    const { container } = render(
      <DictionaryProvider dict={en}>
        <RowFreshness {...props}><span>cms-database</span></RowFreshness>
      </DictionaryProvider>,
    );
    const marked = container.querySelector('[data-freshness]');
    if (marked === null) throw new Error('the cue rendered no row wrapper');
    return marked as HTMLElement;
  }

  it('renders a current row with no mark, no tooltip and nothing to announce', () => {
    const row = renderCue({ readAt: LATER, surfaceReadAt: LATER, streamStatus: 'live' });
    expect(row.getAttribute('data-freshness')).toBe('fresh');
    expect(row.className).not.toContain('border-l-2');
    expect(row.getAttribute('title')).toBeNull();
    expect(row.querySelector('.sr-only')).toBeNull();
    // The row's own content is untouched: the cue adds nothing beside the data.
    expect(textOf(row)).toBe('cms-database');
  });

  it('marks a behind row in place, with the instants named for whoever asks', () => {
    const row = renderCue({ readAt: EARLIER, surfaceReadAt: LATER, streamStatus: 'live' });
    expect(row.getAttribute('data-freshness')).toBe('stale');
    expect(row.className).toContain('border-l-2');
    // Why the high-contrast class is pinned: the rule is the whole mark, and a low-contrast theme would
    // otherwise leave it invisible.
    expect(row.className).toContain('high-contrast:border-warning');
    // Why no motion: the mark appears and clears as frames arrive, and a transition would put motion on
    // a data table for no information.
    expect(row.className).not.toMatch(/animate-|transition/);
    expect(row.getAttribute('title')?.startsWith('Read ')).toBe(true);
    expect(textOf(row.querySelector('.sr-only'))).toContain('newest read this page has');
  });

  it('names the dropped stream when that is why the row is marked', () => {
    const row = renderCue({ readAt: EARLIER, surfaceReadAt: LATER, streamStatus: 'reconnecting' });
    expect(row.getAttribute('data-freshness')).toBe('stale');
    expect(textOf(row.querySelector('.sr-only'))).toContain('reconnecting');
  });

  it('stays silent when nothing can date the row', () => {
    const row = renderCue({ readAt: null, surfaceReadAt: LATER, streamStatus: 'live' });
    expect(row.getAttribute('data-freshness')).toBe('unknown');
    expect(row.className).not.toContain('border-l-2');
    expect(row.getAttribute('title')).toBeNull();
  });

  // Why this rides here: the cue's sentence is prose the same way an action label is, so it has to
  // exist in both locales rather than only in the one the tests happen to read.
  it('carries both sentences in both locales', () => {
    for (const dictionary of [en, th] as const) {
      expect(dictionary.live.rowBehind.trim()).not.toBe('');
      expect(dictionary.live.rowUnconfirmed.trim()).not.toBe('');
    }
    expect(th.live.rowBehind).not.toBe(en.live.rowBehind);
  });
});
