// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Pencil, Trash2 } from 'lucide-react';
import en from '@/dictionaries/en.json';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import type { Dictionary } from '@/lib/dictionary';
import { FormField, SelectField, TextareaField } from '@/components/core/FormField';
import { InlineAlert } from '@/components/core/InlineAlert';
import { RowActions, type RowAction } from '@/components/core/RowActions';
import { ModalFooter } from '@/components/core/ModalFooter';
import { SectionCard } from '@/components/core/SectionCard';
import { NameDialog } from '@/components/core/NameDialog';
import { MetricCard } from '@/components/core/MetricCard';
import { StatusCard } from '@/components/core/StatusCard';

afterEach(() => cleanup());

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled === true;
}

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

describe('FormField', () => {
  it('associates hint and error with the control and marks it invalid', () => {
    render(<FormField id="description" label="Description" hint="Required detail" error="Enter a value">{(props) => <TextareaField {...props} aria-label="Description" />}</FormField>);
    const control = screen.getByLabelText('Description');
    expect(control.getAttribute('aria-invalid')).toBe('true');
    expect(control.getAttribute('aria-describedby')).toContain('description-hint');
    expect(control.getAttribute('aria-describedby')).toContain('description-error');
    expect(screen.getByText('Required detail')).not.toBeNull();
    expect(screen.getByText('Enter a value')).not.toBeNull();
  });

  it('leaves the control valid and undescribed when there is no error', () => {
    render(<FormField id="name" label="Name">{(props) => <TextareaField {...props} />}</FormField>);
    const control = screen.getByLabelText('Name');
    expect(control.hasAttribute('aria-invalid')).toBe(false);
    expect(control.hasAttribute('aria-describedby')).toBe(false);
  });

  it('marks a required field in its label', () => {
    render(<FormField id="code" label="Code" required>{(props) => <SelectField {...props} />}</FormField>);
    expect(screen.getByText('*').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('SelectField', () => {
  it('associates its label, error, and hint with the select element', () => {
    render(<SelectField id="lane" label="Lane" hint="Pick one" error="Lane required" defaultValue="a"><option value="a">Alpha</option></SelectField>);
    const control = screen.getByLabelText('Lane');
    expect(control.tagName).toBe('SELECT');
    expect(control.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Lane required')).not.toBeNull();
    expect(screen.getByText('Pick one')).not.toBeNull();
  });
});

describe('RowActions', () => {
  it('stops parent row propagation and keeps 44px targets', () => {
    const onRowClick = vi.fn();
    render(<div onClick={onRowClick}><RowActions ariaLabel="Task actions" actions={EDIT_DELETE} /></div>);
    expect(screen.getByRole('group', { name: 'Task actions' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onRowClick).not.toHaveBeenCalled();
    const edit = screen.getByRole('button', { name: 'Edit' });
    expect(edit.className).toContain('h-11');
    expect(edit.className).toContain('w-11');
  });

  it('omits actions the caller marks invisible and disables a pending one', () => {
    render(<RowActions ariaLabel="Dataset actions" actions={[
      { key: 'hidden', label: 'Never', icon: Pencil, onClick: () => undefined, isVisible: false },
      { key: 'busy', label: 'Save', icon: Pencil, onClick: () => undefined, loading: true },
      { key: 'off', label: 'Remove', icon: Trash2, onClick: () => undefined, disabled: true },
    ]} />);
    expect(screen.queryByRole('button', { name: 'Never' })).toBeNull();
    expect(isDisabled(screen.getByRole('button', { name: 'Save' }))).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: 'Remove' }))).toBe(true);
  });
});

describe('ModalFooter', () => {
  it('locks confirm while pending and keeps cancel reachable', () => {
    const onCancel = vi.fn();
    render(<ModalFooter cancelLabel="Cancel" confirmLabel="Save" onCancel={onCancel} onConfirm={() => undefined} confirmLoading />);
    expect(isDisabled(screen.getByRole('button', { name: 'Save' }))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('submits through the owning form when given a form id', () => {
    render(<form id="contest-form"><ModalFooter formId="contest-form" cancelLabel="Cancel" confirmLabel="Create" onCancel={() => undefined} onConfirm={() => undefined} /></form>);
    const confirm = screen.getByRole('button', { name: 'Create' });
    expect(confirm.getAttribute('type')).toBe('submit');
    expect(confirm.getAttribute('form')).toBe('contest-form');
  });

  it('splits the actions apart when a dialog carries a body action', () => {
    const { container } = render(<ModalFooter layout="split" cancelLabel="Cancel" confirmLabel="Save" onCancel={() => undefined} onConfirm={() => undefined} />);
    expect(container.querySelector('[data-footer-layout="split"]')).not.toBeNull();
  });

});

describe('SectionCard', () => {
  it('keeps expansion owner-controlled and marks the header state', () => {
    const onToggle = vi.fn();
    const header = { title: 'Tasks', icon: <span>T</span>, count: 3 };
    const { rerender } = render(<SectionCard {...header} expanded={false} onToggle={onToggle}><p>Body</p></SectionCard>);
    expect(screen.getByRole('button', { name: /Tasks/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Body')).toBeNull();
    expect(screen.getByText('(3)')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Tasks/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<SectionCard {...header} expanded onToggle={onToggle}><p>Body</p></SectionCard>);
    expect(screen.getByText('Body')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Tasks/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('does not toggle when a header action is used', () => {
    const onToggle = vi.fn();
    render(<SectionCard title="Datasets" expanded onToggle={onToggle} actions={<button type="button">Create</button>}><p>Body</p></SectionCard>);
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('InlineAlert', () => {
  it('announces itself as an alert and tones by severity', () => {
    render(<InlineAlert tone="warning" title="Unsaved changes">Review before leaving.</InlineAlert>);
    const alert = screen.getByRole('alert');
    expect(textOf(alert)).toContain('Unsaved changes');
    expect(alert.className).toContain('warning');
  });

  it('exposes inline actions without swallowing them', () => {
    const onRetry = vi.fn();
    render(<InlineAlert tone="destructive" title="Delete failed" actions={<button type="button" onClick={onRetry}>Retry</button>}>The record was not removed.</InlineAlert>);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

});

describe('MetricCard', () => {
  it('renders a label with its value, unit, description, and footer', () => {
    render(<MetricCard label="Running" value={3} unit="workers" description="Across all hosts" icon={<span>i</span>} tone="success" footer={<span>updated</span>} />);
    expect(screen.getByText('Running')).not.toBeNull();
    expect(screen.getByText('3')).not.toBeNull();
    expect(screen.getByText('workers')).not.toBeNull();
    expect(screen.getByText('Across all hosts')).not.toBeNull();
    expect(screen.getByText('updated')).not.toBeNull();
  });
});

describe('StatusCard', () => {
  it('renders a status badge beside its description', () => {
    render(withDictionary(en, <StatusCard title="Workers" status="healthy" description="All online" />));
    expect(screen.getByText('Workers')).not.toBeNull();
    expect(screen.getByText('All online')).not.toBeNull();
    expect(screen.getByText('Healthy')).not.toBeNull();
  });

  it('keeps the status contract out of the metric card', () => {
    const { container } = render(withDictionary(en, <StatusCard title="Disk" status="offline" description="Unreachable" actions={<button type="button">Retry</button>}><p>detail</p></StatusCard>));
    expect(container.querySelector('[data-card-kind="status"]')).not.toBeNull();
    expect(container.querySelector('[data-card-kind="metric"]')).toBeNull();
    expect(screen.getByText('detail')).not.toBeNull();
  });

});

describe('NameDialog', () => {
  it('trims once, calls submit once, and closes on success', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ success: true });
    const onOpenChange = vi.fn();
    render(<NameDialog open onOpenChange={onOpenChange} title="Rename dataset" initialValue="  old  " submitLabel="Save" cancelLabel="Cancel" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith('old');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows the validation message without calling submit', () => {
    const onSubmit = vi.fn();
    render(<NameDialog open onOpenChange={() => undefined} title="Rename" initialValue="  " submitLabel="Save" cancelLabel="Cancel" validate={() => 'Enter a value'} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a value')).not.toBeNull();
  });

  it('surfaces the error the submit action returns and keeps the dialog open', async () => {
    const onOpenChange = vi.fn();
    render(<NameDialog open onOpenChange={onOpenChange} title="Clone" initialValue="copy" submitLabel="Clone" cancelLabel="Cancel" onSubmit={vi.fn().mockResolvedValue({ success: false, error: 'Name already used' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }));
    await waitFor(() => expect(screen.getByText('Name already used')).not.toBeNull());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('refuses to dismiss while a submit is pending', async () => {
    const onOpenChange = vi.fn();
    render(
      <NameDialog open onOpenChange={onOpenChange} title="Rename" initialValue="a" submitLabel="Save" cancelLabel="Cancel" onSubmit={() => new Promise(() => undefined)} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(isDisabled(screen.getByRole('button', { name: 'Save' }))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
