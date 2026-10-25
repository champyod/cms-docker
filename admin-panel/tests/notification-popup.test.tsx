// @vitest-environment happy-dom
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { NotificationPopup } from '@/components/layout/NotificationPopup';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import type { QueuedNotification } from '@/lib/notification-queue';
import { auditCueCopy } from '@/lib/system-alert-copy';

// Why the pathname is supplied: the panel resolves the locale its links are built with from the
// router, which a bare render does not provide.
vi.mock('next/navigation', () => ({ usePathname: () => '/en/administration/audit' }));

// Why globals are disabled in vitest.config.ts, so @testing-library/react's
// automatic afterEach cleanup does not run; see audit-detail-error.test.tsx.
afterEach(() => cleanup());

const noop = (): void => undefined;

function alert(overrides: Partial<QueuedNotification> = {}): QueuedNotification {
  return {
    id: 'audit-42',
    level: 'critical',
    cue: { kind: 'critical', verb: 'service:deploy', actor: 'Ada', target: 'Midterm' },
    timestamp: '2026-10-14T09:00:00.000Z',
    destination: 'administration.audit',
    ...overrides,
  };
}

interface HarnessProps {
  readonly events: readonly QueuedNotification[];
  readonly onOpenChange?: (open: boolean) => void;
  readonly dictionary?: typeof en;
}

/**
 * Why the panel is mounted through an anchor: it belongs to a control on the page, and the anchor is
 * what the panel exempts from its own outside-press dismissal.
 */
function Harness({ events, onOpenChange, dictionary = en }: HarnessProps): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const anchorRef = useRef<HTMLDivElement>(null);
  return (
    <DictionaryProvider dict={dictionary}>
      <div ref={anchorRef} data-testid="bell-anchor">
        <NotificationPopup
          open={open}
          onOpenChange={(next): void => {
            onOpenChange?.(next);
            setOpen(next);
          }}
          anchorRef={anchorRef}
          events={events}
          onClear={noop}
          onMarkAllRead={noop}
        />
      </div>
    </DictionaryProvider>
  );
}

describe('alert popup entries', () => {
  it('links an alert that carries a destination to the route it names', () => {
    render(<Harness events={[alert()]} />);

    expect(screen.getByRole('link').getAttribute('href')).toBe('/en/administration/audit');
    expect(screen.getByText(auditCueCopy(alert().cue, en.systemAlerts.audit).title)).toBeTruthy();
  });

  it('renders an alert with no destination as text, never as a dead link', () => {
    render(<Harness events={[alert({ destination: undefined })]} />);

    expect(screen.queryByRole('link')).toBeNull();
    // Why derived from the dictionary: the row composes its words from the frame's parts, so a test that
    // hard-coded the sentence would keep passing after the copy moved.
    const copy = auditCueCopy(alert().cue, en.systemAlerts.audit);
    expect(screen.getByText(copy.title)).toBeTruthy();
    expect(screen.getByText(copy.detail)).toBeTruthy();
  });

  it('writes the row in the reader’s locale, not in one stored sentence', () => {
    // Why two locales and an inequality: a single-locale assertion passes whether the words came from
    // the dictionary or from an English sentence beside it — the defect this row had.
    const { unmount } = render(<Harness events={[alert()]} />);
    expect(screen.getByText(auditCueCopy(alert().cue, en.systemAlerts.audit).detail)).toBeTruthy();
    unmount();

    const thai = auditCueCopy(alert().cue, th.systemAlerts.audit);
    render(<Harness events={[alert()]} dictionary={th} />);
    expect(screen.getByText(thai.title)).toBeTruthy();
    expect(screen.getByText(thai.detail)).toBeTruthy();
    expect(screen.queryByText(auditCueCopy(alert().cue, en.systemAlerts.audit).title)).toBeNull();
  });

  it('keeps an alert the panel has no page for on the same list as the linked ones', () => {
    render(
      <Harness
        events={[
          alert({ id: 'audit-1' }),
          alert({
            id: 'audit-2',
            cue: { kind: 'critical', verb: 'contest:delete', actor: 'Ada', target: 'Midterm' },
            destination: undefined,
          }),
        ]}
      />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('says so instead of showing an empty list when no alert has arrived', () => {
    render(<Harness events={[]} />);

    expect(screen.getByText(en.systemAlerts.empty)).toBeTruthy();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

describe('alert popup layering', () => {
  it('renders on its own layer, portalled out of the shell it belongs to', () => {
    render(<Harness events={[alert()]} />);

    const panel = screen.getByRole('dialog');
    // Why the parent: the panel is drawn from the portal, so no header's own overflow or stacking
    // context can clip it, and nothing the shell renders decides where it lands.
    expect(panel.parentElement).toBe(document.body);
    expect(screen.getByTestId('bell-anchor').contains(panel)).toBe(false);
    expect(panel.className).toContain('fixed');
  });

  it('keeps the panel on the layer dialog content already uses, and raises nothing', () => {
    render(<Harness events={[alert()]} />);

    const panel = screen.getByRole('dialog');
    expect(panel.className).toContain('z-50');
    expect(panel.className).not.toMatch(/z-\[\d+\]/);
  });

  it('stays non-modal, so the page behind it keeps its own focus and presses', () => {
    render(<Harness events={[alert()]} />);

    const panel = screen.getByRole('dialog');
    expect(panel.getAttribute('aria-modal')).toBeNull();
    expect(document.body.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
  });

  it('names itself from the dictionary it is given, in both locales', () => {
    const { unmount } = render(<Harness events={[alert()]} />);
    expect(screen.getByRole('dialog', { name: en.systemAlerts.title })).toBeTruthy();
    unmount();

    render(<Harness events={[alert()]} dictionary={th} />);
    expect(screen.getByRole('dialog', { name: th.systemAlerts.title })).toBeTruthy();
    expect(screen.getByRole('button', { name: th.systemAlerts.markAllRead })).toBeTruthy();
    expect(screen.getByRole('button', { name: th.systemAlerts.clear })).toBeTruthy();
  });

  it('closes on escape', async () => {
    const onOpenChange = vi.fn();
    render(<Harness events={[alert()]} onOpenChange={onOpenChange} />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes from the dialog control it shares with every other dialog', async () => {
    const onOpenChange = vi.fn();
    render(<Harness events={[alert()]} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
