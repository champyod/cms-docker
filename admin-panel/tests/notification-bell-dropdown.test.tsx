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

  it('clamps the dropdown to the viewport on small screens', () => {
    const view = render(<NotificationBell />);
    fireEvent.click(view.getByRole('button', { name: 'System alerts' }));
    const dropdown = view.getByText('No alerts yet.').parentElement as HTMLElement;
    expect(dropdown.className).toContain('w-[min(80vw,20rem)]');
    expect(dropdown.className).toContain('max-w-[calc(100vw_-_1.5rem)]');
    expect(dropdown.className).not.toContain('w-80');
  });
});