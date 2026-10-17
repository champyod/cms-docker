// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { NotificationBell } from '@/components/layout/NotificationBell';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import en from '@/dictionaries/en.json';

// Why the pathname is supplied: the panel resolves the locale its links are built with from the
// router, which a bare render does not provide.
vi.mock('next/navigation', () => ({ usePathname: () => '/en/administration/audit' }));

// Why globals are disabled in vitest.config.ts, so @testing-library/react's
// automatic afterEach cleanup does not run; see audit-detail-error.test.tsx.
afterEach(() => cleanup());

interface BellHandlers {
  readonly onSeen: ReturnType<typeof vi.fn>;
  readonly onClear: ReturnType<typeof vi.fn>;
}

function renderBell(unread = 0): BellHandlers {
  const onSeen = vi.fn();
  const onClear = vi.fn();
  render(
    <DictionaryProvider dict={en}>
      <NotificationBell events={[]} unread={unread} onClear={onClear} onSeen={onSeen} />
    </DictionaryProvider>,
  );
  return { onSeen, onClear };
}

function bell(): HTMLElement {
  return screen.getByRole('button', { name: en.systemAlerts.title });
}

describe('NotificationBell', () => {
  it('opens the alerts panel from the bell and closes it from the bell again', async () => {
    renderBell();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(bell());
    expect(await screen.findByRole('dialog', { name: en.systemAlerts.title })).toBeTruthy();

    fireEvent.click(bell());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('clears the count when the panel opens, not when it closes', async () => {
    const { onSeen } = renderBell(3);

    fireEvent.click(bell());
    await screen.findByRole('dialog');
    expect(onSeen).toHaveBeenCalledTimes(1);

    fireEvent.click(bell());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onSeen).toHaveBeenCalledTimes(1);
  });

  it('reports the panel it owns to assistive technology', async () => {
    renderBell();
    const button = bell();
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(button);
    await screen.findByRole('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('returns focus to the bell when the panel closes', async () => {
    renderBell();
    const button = bell();
    // Why the explicit focus: a real reader arrives at the bell by pressing it or tabbing to it, and
    // the dialog captures whichever element holds focus at the moment it opens.
    button.focus();
    fireEvent.click(button);
    const panel = await screen.findByRole('dialog');

    fireEvent.keyDown(panel, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('dismisses on a press on the page, and keeps the bell its own toggle', async () => {
    renderBell();
    const button = bell();

    fireEvent.click(button);
    await screen.findByRole('dialog');
    // Why the pair: an outside press is only a dismissal once the click that follows it lands.
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(button);
    await screen.findByRole('dialog');
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('marks all read and clears through the callbacks the service handed it', async () => {
    const { onSeen, onClear } = renderBell(1);
    fireEvent.click(bell());
    await screen.findByRole('dialog');

    // Opening the panel is itself what clears the bell's count.
    expect(onSeen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: en.systemAlerts.markAllRead }));
    expect(onSeen).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: en.systemAlerts.clear }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
