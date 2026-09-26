// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Pencil, Trash2, Upload } from 'lucide-react';

import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { InlineAlert } from '@/components/core/InlineAlert';
import { ModalFooter } from '@/components/core/ModalFooter';
import { RowActions, ROW_ACTION_GROUP_TYPES, rowActionGroupLabel, type RowAction } from '@/components/core/RowActions';
import { StatusCard, type StatusCardStatus } from '@/components/core/StatusCard';
import type { Dictionary } from '@/lib/dictionary';

afterEach(() => cleanup());

function textOf(element: Element | null): string {
  return element?.textContent ?? '';
}

function withDictionary(dictionary: Dictionary, node: React.ReactNode): React.JSX.Element {
  return <DictionaryProvider dict={dictionary}>{node}</DictionaryProvider>;
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

  it('leaves pending cancellation with the caller once a leading control exists', () => {
    const onCancel = vi.fn();
    render(
      <ModalFooter
        leadingAction={<button type="button">Reset</button>}
        cancelLabel="Cancel"
        confirmLabel="Save"
        onCancel={onCancel}
        onConfirm={() => undefined}
        confirmLoading
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
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

describe('StatusCard dictionary contract', () => {
  it('reads every verdict from the dictionary in both locales', () => {
    const statuses: readonly StatusCardStatus[] = ['healthy', 'degraded', 'offline', 'unknown'];
    for (const [locale, dictionary] of [['en', en], ['th', th]] as const) {
      for (const status of statuses) {
        const { unmount } = render(withDictionary(dictionary, <StatusCard title="Workers" status={status} description="Probe" />));
        expect(textOf(screen.getByText(dictionary.states.status[status])), `${locale} ${status}`).not.toBe('');
        unmount();
      }
    }
  });

  it('keeps the English verdict out of the Thai card and the reverse', () => {
    const { unmount } = render(withDictionary(th, <StatusCard title="Workers" status="offline" description="Probe" />));
    expect(screen.queryByText('Offline')).toBeNull();
    expect(screen.getByText(th.states.status.offline)).not.toBeNull();
    unmount();
    render(withDictionary(en, <StatusCard title="Workers" status="offline" description="Probe" />));
    expect(screen.queryByText(th.states.status.offline)).toBeNull();
    expect(screen.getByText('Offline')).not.toBeNull();
  });

  it('fails closed without a dictionary instead of falling back to English', () => {
    expect(() => render(<StatusCard title="Workers" status="healthy" description="All online" />)).toThrow(/DictionaryProvider/);
  });
});
