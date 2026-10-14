// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ReasonDialog } from '@/components/core/ReasonDialog';
import { useReasonPrompt, type ReasonActionResult } from '@/hooks/useReasonPrompt';

afterEach(() => cleanup());

function Harness({ run }: { run: (reason: string) => Promise<ReasonActionResult> }): React.JSX.Element {
  const prompt = useReasonPrompt();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          prompt.ask({ title: 'Unban 10.0.0.5?', description: 'Queue it.', submitLabel: 'Queue unban', run })
        }
      >
        Open
      </button>
      {prompt.feedback !== null && <p>{prompt.feedback}</p>}
      <ReasonDialog request={prompt.request} onClose={prompt.close} onSubmit={prompt.submit} />
    </>
  );
}

describe('ReasonDialog', () => {
  it('asks for the reason only once an action is chosen', () => {
    render(<Harness run={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(screen.getAllByText('Unban 10.0.0.5?').length).toBeGreaterThan(0);
  });

  it('refuses an empty reason without calling the action', () => {
    const run = vi.fn();
    render(<Harness run={run} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Queue unban' }));
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByText('A reason is required')).not.toBeNull();
  });

  it('runs the action with the reason, closes, and shows its message', async () => {
    const run = vi.fn().mockResolvedValue({ success: true, message: 'Unban queued' });
    render(<Harness run={run} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'compromised host' } });
    fireEvent.click(screen.getByRole('button', { name: 'Queue unban' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith('compromised host'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Unban queued')).not.toBeNull();
  });

  it('keeps the dialog open and surfaces the error the action returns', async () => {
    const run = vi.fn().mockResolvedValue({ success: false, error: 'Not currently banned' });
    render(<Harness run={run} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'typo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Queue unban' }));
    await waitFor(() => expect(screen.getByText('Not currently banned')).not.toBeNull());
    expect(screen.getByRole('dialog')).not.toBeNull();
  });
});
