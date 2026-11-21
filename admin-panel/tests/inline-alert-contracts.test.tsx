// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { InlineAlert } from '@/components/core/InlineAlert';

afterEach(() => cleanup());

describe('InlineAlert announcement contracts', () => {
  it('stays assertive by default, so an outcome-of-an-action is not downgraded', () => {
    render(<InlineAlert tone="success">Team saved</InlineAlert>);
    expect(screen.getByRole('alert')).not.toBeNull();
  });

  it('drops to a polite region for a strip the page found on arrival', () => {
    render(<InlineAlert tone="warning" announce="polite">Configuration Mismatch</InlineAlert>);
    expect(screen.getByRole('status').textContent).toBe('Configuration Mismatch');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the tone and scale the same whichever region carries the strip', () => {
    const { rerender } = render(<InlineAlert tone="warning" density="regular">Notice</InlineAlert>);
    const assertive = screen.getByRole('alert');
    rerender(<InlineAlert tone="warning" density="regular" announce="polite">Notice</InlineAlert>);
    expect(screen.getByRole('status').className).toBe(assertive.className);
  });
});

describe('InlineAlert density contracts', () => {
  it('scales a regular strip to the in-page error box it replaces', () => {
    const { container } = render(<InlineAlert tone="destructive" density="regular">Save failed</InlineAlert>);
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('p-3');
    expect(alert.className).toContain('text-sm');
    expect(alert.className).toContain('border-destructive/20');
    expect(alert.className).toContain('gap-1.5');
    expect(alert.className).not.toContain('p-4');
    expect(alert.className).not.toContain('text-xs');
    expect(alert.querySelector('.min-w-0 > div')?.className).toContain('text-destructive');
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('size-3.5');
  });
});
