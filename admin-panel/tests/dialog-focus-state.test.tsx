// @vitest-environment happy-dom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { Dialog } from '@/components/core/Dialog';
import { NameDialog } from '@/components/core/NameDialog';
import { SidePanel } from '@/components/core/SidePanel';
import { ConfirmProvider } from '@/components/providers/ConfirmProvider';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import { settleConfirmation } from '@/lib/confirmation-store';
import en from '@/dictionaries/en.json';

afterEach(() => {
  // Why this first: the confirmation store is module level, so a prompt a test
  // left unanswered would still be open for the next test and would hide every
  // other dialog behind its aria-hidden overlay.
  settleConfirmation(false);
  cleanup();
  vi.restoreAllMocks();
});

function DialogHarness(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); }}>Open record</button>
      <Dialog open={open} onOpenChange={setOpen} title="Record" description="Details">
        <p>Body</p>
      </Dialog>
    </>
  );
}

// Why the dictionary is mounted here: the discard prompt is the shared
// ConfirmDialog, and it reads its captions and its cancel label from the
// provider the authenticated shell normally supplies.
function withConfirm(node: React.ReactNode): React.JSX.Element {
  return (
    <DictionaryProvider dict={en}>
      <ConfirmProvider>{node}</ConfirmProvider>
    </DictionaryProvider>
  );
}

// Why scoped: the rename dialog and the discard prompt both own a Cancel
// control, so a document-wide query would click whichever mounted first.
async function discardPrompt(): Promise<HTMLElement> {
  return screen.findByRole('dialog', { name: /discard unsaved changes/i });
}

describe('Dialog', () => {
  it('returns focus to the element that opened it', async () => {
    render(<DialogHarness />);
    const invoker = screen.getByRole('button', { name: 'Open record' });
    // Why the explicit focus: a real reader arrives at the control by pressing
    // it or tabbing to it, and the capture reads whichever element holds focus
    // at the moment the dialog opens.
    invoker.focus();
    fireEvent.click(invoker);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(invoker);
  });

  it('reports escape as the dismiss reason', async () => {
    const onOpenChange = vi.fn();
    render(<Dialog open onOpenChange={onOpenChange} title="Record"><p>Body</p></Dialog>);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalled());
    expect(onOpenChange.mock.calls.at(-1)).toEqual([false, 'escape']);
  });

  it('reports the close control as the dismiss reason', async () => {
    const onOpenChange = vi.fn();
    render(<Dialog open onOpenChange={onOpenChange} title="Record"><p>Body</p></Dialog>);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalled());
    expect(onOpenChange.mock.calls.at(-1)).toEqual([false, 'close']);
  });

  it('refuses every dismiss reason while a submit is pending', () => {
    const onOpenChange = vi.fn();
    render(<Dialog open pending onOpenChange={onOpenChange} title="Record"><p>Body</p></Dialog>);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe('NameDialog unsaved changes', () => {
  it('closes a pristine rename without asking', () => {
    const onOpenChange = vi.fn();
    render(withConfirm(
      <NameDialog open onOpenChange={onOpenChange} title="Rename" initialValue="copy" submitLabel="Save" cancelLabel="Cancel" onSubmit={vi.fn()} />,
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('dialog', { name: /discard unsaved changes/i })).toBeNull();
  });

  it('asks before discarding a renamed value and stays open when declined', async () => {
    const onOpenChange = vi.fn();
    render(withConfirm(
      <NameDialog open onOpenChange={onOpenChange} title="Rename" initialValue="copy" submitLabel="Save" cancelLabel="Cancel" onSubmit={vi.fn()} />,
    ));
    fireEvent.change(screen.getByLabelText('Rename', { selector: 'input' }), { target: { value: 'copy 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const prompt = await discardPrompt();
    expect(prompt).toBeTruthy();
    fireEvent.click(within(prompt).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /discard unsaved changes/i })).toBeNull());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('closes the rename once the discard is confirmed', async () => {
    const onOpenChange = vi.fn();
    render(withConfirm(
      <NameDialog open onOpenChange={onOpenChange} title="Rename" initialValue="copy" submitLabel="Save" cancelLabel="Cancel" onSubmit={vi.fn()} />,
    ));
    fireEvent.change(screen.getByLabelText('Rename', { selector: 'input' }), { target: { value: 'copy 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const prompt = await discardPrompt();
    fireEvent.click(within(prompt).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('asks once when the dismiss is repeated before the answer arrives', async () => {
    const onOpenChange = vi.fn();
    render(withConfirm(
      <NameDialog open onOpenChange={onOpenChange} title="Rename" initialValue="copy" submitLabel="Save" cancelLabel="Cancel" onSubmit={vi.fn()} />,
    ));
    fireEvent.change(screen.getByLabelText('Rename', { selector: 'input' }), { target: { value: 'copy 2' } });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancel);
    await discardPrompt();
    fireEvent.click(cancel);
    expect(screen.getAllByRole('dialog', { name: /discard unsaved changes/i })).toHaveLength(1);
  });

  it('does not ask a second time after a successful save', async () => {
    const onOpenChange = vi.fn();
    render(withConfirm(
      <NameDialog
        open
        onOpenChange={onOpenChange}
        title="Rename"
        initialValue="copy"
        submitLabel="Save"
        cancelLabel="Cancel"
        onSubmit={vi.fn().mockResolvedValue({ success: true })}
      />,
    ));
    fireEvent.change(screen.getByLabelText('Rename', { selector: 'input' }), { target: { value: 'copy 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    // The dialog is still mounted because the test controls `open`, and the
    // write already landed, so a second dismissal must not ask a second time.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });
});

describe('SidePanel', () => {
  it('leaves the list behind it interactive and keeps focus on the row', async () => {
    const onRowClick = vi.fn();
    render(
      <>
        <button type="button" onClick={onRowClick}>Row 7</button>
        <SidePanel open onOpenChange={() => undefined} title="Entry 7" description="Recorded by admin">
          <p>Detail body</p>
        </SidePanel>
      </>,
    );
    const invoker = screen.getByRole('button', { name: 'Row 7' });
    invoker.focus();
    fireEvent.click(invoker);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Detail body')).toBeTruthy();
    // Why the wait: the panel's open autofocus lands after the mount that
    // rendered the content, and a non-modal root must leave the row focused.
    await waitFor(() => expect(document.activeElement).toBe(invoker));
  });

  it('names the panel and its description for assistive technology', () => {
    render(<SidePanel open onOpenChange={() => undefined} title="Entry 7" description="Recorded by admin"><p>Body</p></SidePanel>);
    expect(screen.getByRole('dialog', { name: 'Entry 7' }).getAttribute('data-slot')).toBe('side-panel');
    expect(screen.getByText('Recorded by admin')).toBeTruthy();
  });

  it('reports the close back to the caller', async () => {
    const onOpenChange = vi.fn();
    render(<SidePanel open onOpenChange={onOpenChange} title="Entry 7"><p>Body</p></SidePanel>);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
