// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LimitField } from '@/components/core/LimitField';

afterEach(cleanup);

function renderField(value: number | null = null, error?: string) {
  const onChangeValue = vi.fn();
  render(
    <LimitField
      id="max_submission_number"
      label="Max Submissions"
      unit="sec"
      hint="Per user; blank means no limit."
      value={value}
      onChangeValue={onChangeValue}
      error={error}
    />,
  );
  return {
    onChangeValue,
    box: screen.getByLabelText('Max Submissions (sec)') as HTMLInputElement,
    toggle: screen.getByRole('button', { name: 'Unlimited' }),
  };
}

describe('the shared limit field', () => {
  it('keeps the box typable while the unlimited state is on', () => {
    // Why: the old control disabled the box whenever 'Unlimited' was set, so an operator who
    // wanted a number had to switch the toggle off first.
    const { box, toggle } = renderField(null);

    expect(box.disabled).toBe(false);
    expect(box.value).toBe('');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the stored number and an unpressed toggle for a set limit', () => {
    const { box, toggle } = renderField(120);

    expect(box.value).toBe('120');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('commits no limit for a cleared box and for a typed 0, never a 0', () => {
    const { onChangeValue, box } = renderField(5);

    fireEvent.change(box, { target: { value: '' } });
    expect(onChangeValue).toHaveBeenLastCalledWith(null);

    fireEvent.change(box, { target: { value: '0' } });
    expect(onChangeValue).toHaveBeenLastCalledWith(null);
    expect(onChangeValue).not.toHaveBeenCalledWith(0);
  });

  it('commits a positive whole number as typed', () => {
    const { onChangeValue, box } = renderField(null);

    fireEvent.change(box, { target: { value: '90' } });

    expect(onChangeValue).toHaveBeenCalledWith(90);
  });

  it('refuses a pasted negative or fraction instead of passing it on', () => {
    const { onChangeValue, box } = renderField(5);

    fireEvent.change(box, { target: { value: '-3' } });
    expect(onChangeValue).toHaveBeenLastCalledWith(null);

    fireEvent.change(box, { target: { value: '2.5' } });
    expect(onChangeValue).toHaveBeenLastCalledWith(null);
  });

  it('clears a set limit to no limit from the toggle', () => {
    const { onChangeValue, toggle } = renderField(7);

    fireEvent.click(toggle);

    expect(onChangeValue).toHaveBeenCalledWith(null);
    expect(onChangeValue).not.toHaveBeenCalledWith(0);
  });

  it('hands the caret to the box when the toggle is pressed while unlimited', () => {
    // Why: turning the state off would have to restore a positive number, and there is none to
    // restore, so the press only starts the operator typing.
    const { onChangeValue, box, toggle } = renderField(null);

    fireEvent.click(toggle);

    expect(onChangeValue).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(box);
  });

  it('shows the error under the box and points the box at it', () => {
    const { box } = renderField(5, 'Max submission number must be greater than 0');

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Max submission number must be greater than 0');
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(box.getAttribute('aria-describedby')).toContain(alert.id);
  });
});
