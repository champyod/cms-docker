// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionGlobalConfig } from 'motion/react';
import { ContestCountdownTimezoneMenu } from '@/components/contests/contest-detail/ContestCountdownTimezoneMenu';

// Why: happy-dom rejects on Animation.cancel() when an unfinished animation is torn down, and
// vitest fails the run on that unhandled rejection; instant animations avoid the driver.
MotionGlobalConfig.skipAnimations = true;

// Why: globals are disabled in vitest.config.ts, so the automatic afterEach cleanup does not
// run and every render would otherwise stay in the document; see notification-bell-dropdown.test.tsx.
afterEach(() => cleanup());

const PANEL_SELECTOR = '.countdown-zone-panel';

describe('countdown timezone panel', () => {
  it('stays closed until its control is used', () => {
    render(<ContestCountdownTimezoneMenu value="UTC" onChange={() => undefined} />);
    expect(document.querySelector(PANEL_SELECTOR)).toBeNull();
  });

  it('portals the open panel onto the body, outside the toolbar it belongs to', async () => {
    const user = userEvent.setup();
    const { container } = render(<ContestCountdownTimezoneMenu value="UTC" onChange={() => undefined} />);

    await user.click(screen.getByRole('button', { name: 'Select timezone' }));

    const panel = document.querySelector(PANEL_SELECTOR);
    expect(panel).not.toBeNull();
    // The front layer is the body: that is what lifts the panel out of the surface's clip.
    expect(panel?.parentElement).toBe(document.body);
    expect(container.contains(panel)).toBe(false);
  });

  it('lists the zones and reports the one that was picked', async () => {
    const user = userEvent.setup();
    const picked: string[] = [];
    render(<ContestCountdownTimezoneMenu value="UTC" onChange={(zone) => picked.push(zone)} />);

    await user.click(screen.getByRole('button', { name: 'Select timezone' }));
    // The list shows the first 200 of the runtime's zones, so the search box is what reaches the rest.
    await user.type(screen.getByRole('textbox', { name: 'Search timezone' }), 'Bangkok');
    await user.click(screen.getByRole('option', { name: /^Asia\/Bangkok/ }));

    expect(picked).toEqual(['Asia/Bangkok']);
  });
});
