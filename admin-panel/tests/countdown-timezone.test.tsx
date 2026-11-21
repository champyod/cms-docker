// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useCountdownTimezone } from '@/components/contests/contest-detail/useContestCountdown';

// Node exposes a global localStorage accessor happy-dom cannot override, so supply our own store.
function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length(): number {
      return entries.size;
    },
    clear: (): void => {
      entries.clear();
    },
    getItem: (key: string): string | null => entries.get(key) ?? null,
    key: (index: number): string | null => [...entries.keys()][index] ?? null,
    removeItem: (key: string): void => {
      entries.delete(key);
    },
    setItem: (key: string, value: string): void => {
      entries.set(key, String(value));
    },
  };
}

// Why: globals are off in vitest.config.ts, so without this a later render would stay mounted.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
// Why: a persisted pick outlives one test in the store, so each case starts clean.
beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));

const STORAGE_KEY = 'contest-countdown-timezone';

function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

interface ProbeProps {
  readonly contestTimezone: string | null;
  readonly isFullscreen: boolean;
  readonly pick: string;
}

function Probe({ contestTimezone, isFullscreen, pick }: ProbeProps): React.JSX.Element {
  const { timezone, setTimezone } = useCountdownTimezone({ contestTimezone, isFullscreen });
  return (
    <div>
      <span data-testid="zone">{timezone}</span>
      <button type="button" onClick={() => setTimezone(pick)}>pick</button>
    </div>
  );
}

function currentZone(): string {
  return screen.getByTestId('zone').textContent ?? '';
}

function storedOverride(): string | null {
  return window.localStorage.getItem(STORAGE_KEY);
}

function seedOverride(zone: string, basis: string | null): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ zone, basis }));
}

describe('countdown display zone', () => {
  it('seeds from the owning contest zone with no stored pick', () => {
    render(<Probe contestTimezone="Asia/Tokyo" isFullscreen={false} pick="UTC" />);
    expect(currentZone()).toBe('Asia/Tokyo');
  });

  it('falls back to the browser zone when the contest has no zone', () => {
    render(<Probe contestTimezone={null} isFullscreen={false} pick="UTC" />);
    expect(currentZone()).toBe(browserZone());
  });

  it('falls back to the browser zone when the contest zone is unusable', () => {
    render(<Probe contestTimezone="Not/AZone" isFullscreen={false} pick="UTC" />);
    expect(currentZone()).toBe(browserZone());
  });
});

describe('per-browser persistence outside full screen', () => {
  it('stores a pick and reuses it on a fresh mount', () => {
    const first = render(<Probe contestTimezone="Asia/Tokyo" isFullscreen={false} pick="Europe/Rome" />);
    fireEvent.click(screen.getByRole('button', { name: 'pick' }));
    expect(currentZone()).toBe('Europe/Rome');
    expect(JSON.parse(storedOverride() ?? '{}')).toEqual({ zone: 'Europe/Rome', basis: 'Asia/Tokyo' });
    first.unmount();

    render(<Probe contestTimezone="Asia/Tokyo" isFullscreen={false} pick="UTC" />);
    expect(currentZone()).toBe('Europe/Rome');
  });

  it('honors a stored pick made against the same contest zone', () => {
    seedOverride('Europe/Rome', 'Asia/Tokyo');
    render(<Probe contestTimezone="Asia/Tokyo" isFullscreen={false} pick="UTC" />);
    expect(currentZone()).toBe('Europe/Rome');
  });

  it('discards a stored pick made against a different contest zone', () => {
    seedOverride('America/New_York', 'Asia/Tokyo');
    render(<Probe contestTimezone="Europe/London" isFullscreen={false} pick="UTC" />);
    expect(currentZone()).toBe('Europe/London');
  });

  it('re-defaults when the contest zone changes under a stored pick', () => {
    seedOverride('America/New_York', 'Asia/Tokyo');
    const view = render(<Probe contestTimezone="Asia/Tokyo" isFullscreen={false} pick="UTC" />);
    expect(currentZone()).toBe('America/New_York');

    view.rerender(<Probe contestTimezone="Asia/Singapore" isFullscreen={false} pick="UTC" />);
    expect(currentZone()).toBe('Asia/Singapore');
  });

  it('ignores a stored value in the pre-upgrade plain-zone format', () => {
    window.localStorage.setItem(STORAGE_KEY, 'Europe/Rome');
    render(<Probe contestTimezone="Asia/Tokyo" isFullscreen={false} pick="UTC" />);
    expect(currentZone()).toBe('Asia/Tokyo');
  });
});

describe('session-only override in full screen', () => {
  it('applies a full-screen pick without persisting it', () => {
    render(<Probe contestTimezone="Asia/Tokyo" isFullscreen pick="Europe/Rome" />);
    fireEvent.click(screen.getByRole('button', { name: 'pick' }));
    expect(currentZone()).toBe('Europe/Rome');
    expect(storedOverride()).toBeNull();
  });

  it('reverts to the contest zone on leaving full screen', () => {
    const view = render(<Probe contestTimezone="Asia/Tokyo" isFullscreen pick="Europe/Rome" />);
    fireEvent.click(screen.getByRole('button', { name: 'pick' }));
    expect(currentZone()).toBe('Europe/Rome');

    view.rerender(<Probe contestTimezone="Asia/Tokyo" isFullscreen={false} pick="Europe/Rome" />);
    expect(currentZone()).toBe('Asia/Tokyo');
    expect(storedOverride()).toBeNull();
  });

  it('takes precedence over a stored per-browser pick, then yields back to it', () => {
    seedOverride('America/New_York', 'Asia/Tokyo');
    const view = render(<Probe contestTimezone="Asia/Tokyo" isFullscreen pick="UTC" />);
    expect(currentZone()).toBe('America/New_York');

    fireEvent.click(screen.getByRole('button', { name: 'pick' }));
    expect(currentZone()).toBe('UTC');

    view.rerender(<Probe contestTimezone="Asia/Tokyo" isFullscreen={false} pick="UTC" />);
    expect(currentZone()).toBe('America/New_York');
  });
});
