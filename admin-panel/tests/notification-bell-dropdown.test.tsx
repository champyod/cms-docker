// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NotificationBell } from '@/components/layout/NotificationBell';

// Why: globals are disabled in vitest.config.ts, so @testing-library/react's
// automatic afterEach cleanup does not run; see audit-detail-error.test.tsx.
afterEach(() => cleanup());

vi.mock('@/hooks/useLiveStream', () => ({
  useLiveStream: () => ({ status: 'live', refresh: vi.fn() }),
}));

describe('NotificationBell dropdown', () => {
  it('opens the alerts list on bell click', () => {
    const view = render(<NotificationBell />);
    fireEvent.click(view.getByRole('button', { name: 'System alerts' }));
    expect(view.getByText('No alerts yet.')).toBeTruthy();
  });

  it('uses viewport insets on phones and restores the anchored dropdown at sm', () => {
    const view = render(<NotificationBell />);
    fireEvent.click(view.getByRole('button', { name: 'System alerts' }));
    const dropdown = view.getByText('No alerts yet.').parentElement as HTMLElement;
    expect(dropdown.className).toContain('fixed');
    expect(dropdown.className).toContain('inset-x-3');
    expect(dropdown.className).toContain('top-16');
    expect(dropdown.className).toContain('sm:absolute');
    expect(dropdown.className).toContain('sm:left-auto');
    expect(dropdown.className).toContain('sm:right-0');
    expect(dropdown.className).toContain('sm:top-auto');
    expect(dropdown.className).toContain('sm:mt-2');
    expect(dropdown.className).toContain('sm:w-80');
    expect(dropdown.className).toContain('sm:max-w-none');
    expect(dropdown.className).not.toContain('w-[min(80vw,20rem)]');
    expect(dropdown.className).not.toContain('max-w-[calc(100vw_-_1.5rem)]');
  });
});