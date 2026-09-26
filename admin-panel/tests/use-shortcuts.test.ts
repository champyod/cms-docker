import { describe, expect, it, vi } from 'vitest';
import {
  bindingsForPermissions,
  CHORD_PREFIX_KEY,
  CHORD_TIMEOUT_MS,
  IDLE_CHORD,
  OVERLAY_TOGGLE_KEY,
  clampRowIndex,
  extractLocale,
  handleShortcutEvent,
  isEditableTarget,
  nextRowIndex,
  type ShortcutHandlerDeps,
  type ShortcutKeyEvent,
} from '@/hooks/useShortcuts';
import { visibleRoutes } from '@/lib/navigation/registry';

const ALL_PERMISSIONS: readonly string[] = ['all:all'];

function chordRouteIds(permissionKeys: readonly string[] | undefined): string[] {
  return bindingsForPermissions(permissionKeys).map((entry) => entry.routeId);
}

function keyEvent(key: string, overrides: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return {
    key,
    defaultPrevented: false,
    target: { tagName: 'BODY' },
    preventDefault: vi.fn(),
    ...overrides,
  };
}

interface Harness {
  navigated: string[];
  toggles: number;
  chordState: { current: typeof IDLE_CHORD };
  selectedRowIndex: { current: number };
  deps: (overlayOpen?: boolean) => ShortcutHandlerDeps;
}

function makeHarness(locale = 'th'): Harness {
  const state: Harness = {
    navigated: [],
    toggles: 0,
    chordState: { current: IDLE_CHORD },
    selectedRowIndex: { current: -1 },
    deps: (overlayOpen = false) => ({
      navigate: (href) => state.navigated.push(href),
      getLocale: () => locale,
      isOverlayOpen: () => overlayOpen,
      toggleOverlay: () => {
        state.toggles += 1;
      },
      chordState: state.chordState,
      selectedRowIndex: state.selectedRowIndex,
    }),
  };
  return state;
}

describe('g-chord sequencing', () => {
  it('navigates when a bound letter follows g within the timeout', () => {
    const h = makeHarness();
    handleShortcutEvent(keyEvent('g'), h.deps(), 0);
    handleShortcutEvent(keyEvent('c'), h.deps(), 100);
    expect(h.navigated).toEqual(['/th/contests']);
  });

  it('does not navigate for an unbound letter and resets the chord', () => {
    const h = makeHarness();
    handleShortcutEvent(keyEvent('g'), h.deps(), 0);
    handleShortcutEvent(keyEvent('x'), h.deps(), 100);
    handleShortcutEvent(keyEvent('c'), h.deps(), 200);
    expect(h.navigated).toEqual([]);
  });

  it('expires the chord after the timeout window', () => {
    const h = makeHarness();
    handleShortcutEvent(keyEvent('g'), h.deps(), 0);
    handleShortcutEvent(keyEvent('c'), h.deps(), CHORD_TIMEOUT_MS + 1);
    expect(h.navigated).toEqual([]);
  });

  it('restarts the timeout window on a repeated g', () => {
    const h = makeHarness();
    handleShortcutEvent(keyEvent('g'), h.deps(), 0);
    handleShortcutEvent(keyEvent('g'), h.deps(), 900);
    handleShortcutEvent(keyEvent('t'), h.deps(), 1700);
    expect(h.navigated).toEqual(['/th/tasks']);
  });

  it('ignores plain letters pressed without a pending g', () => {
    const h = makeHarness();
    handleShortcutEvent(keyEvent('c'), h.deps(), 0);
    expect(h.navigated).toEqual([]);
    expect(h.chordState.current).toEqual(IDLE_CHORD);
  });

  it('covers every route on the shortcuts surface exactly once', () => {
    // Why: a chord navigates straight to a page, so every route another surface
    // exposes must be reachable by key too — and a duplicated key would make one
    // of them unreachable without any visible failure.
    expect(chordRouteIds(undefined).sort()).toEqual(
      visibleRoutes(new Set(ALL_PERMISSIONS), 'shortcuts')
        .map((route) => route.id)
        .sort(),
    );
    const keys = bindingsForPermissions(undefined).map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the chord prefix, row keys, and overlay key free as destinations', () => {
    const keys = bindingsForPermissions(undefined).map((entry) => entry.key);
    for (const reserved of [CHORD_PREFIX_KEY, 'j', 'k', OVERLAY_TOGGLE_KEY]) {
      expect(keys).not.toContain(reserved);
    }
  });
});

describe('input-focus suppression', () => {
  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('suppresses shortcuts inside %s', (tagName) => {
    const h = makeHarness();
    handleShortcutEvent(keyEvent('g', { target: { tagName } }), h.deps(), 0);
    handleShortcutEvent(keyEvent('c', { target: { tagName } }), h.deps(), 100);
    expect(h.navigated).toEqual([]);
    expect(h.chordState.current).toEqual(IDLE_CHORD);
  });

  it('suppresses shortcuts in contenteditable targets', () => {
    const h = makeHarness();
    handleShortcutEvent(keyEvent('?', { target: { tagName: 'DIV', isContentEditable: true } }), h.deps(), 0);
    expect(h.toggles).toBe(0);
  });

  it('reports editable targets from duck-typed elements', () => {
    expect(isEditableTarget({ tagName: 'input' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV' })).toBe(false);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
  });
});

describe('overlay toggle and suppression', () => {
  it('? toggles the shortcut overlay', () => {
    const h = makeHarness();
    handleShortcutEvent(keyEvent('?'), h.deps(), 0);
    expect(h.toggles).toBe(1);
  });

  it('does not toggle the overlay while typing in an input', () => {
    const h = makeHarness();
    handleShortcutEvent(keyEvent('?', { target: { tagName: 'INPUT' } }), h.deps(), 0);
    expect(h.toggles).toBe(0);
  });

  it('suppresses navigation chords while the overlay is open', () => {
    const h = makeHarness();
    handleShortcutEvent(keyEvent('g'), h.deps(true), 0);
    handleShortcutEvent(keyEvent('c'), h.deps(true), 100);
    expect(h.navigated).toEqual([]);
  });

  it('ignores modified keys entirely', () => {
    const h = makeHarness();
    handleShortcutEvent(keyEvent('?', { ctrlKey: true }), h.deps(), 0);
    handleShortcutEvent(keyEvent('g', { metaKey: true }), h.deps(), 0);
    expect(h.toggles).toBe(0);
    expect(h.chordState.current).toEqual(IDLE_CHORD);
  });
});

describe('j/k row index clamping', () => {
  it('clamps selection within bounds', () => {
    expect(clampRowIndex(-5, 3)).toBe(0);
    expect(clampRowIndex(2, 3)).toBe(2);
    expect(clampRowIndex(9, 3)).toBe(2);
  });

  it('returns -1 when there are no rows', () => {
    expect(clampRowIndex(0, 0)).toBe(-1);
    expect(clampRowIndex(-1, 0)).toBe(-1);
  });

  it('moves down with j, selecting the first row from nothing', () => {
    expect(nextRowIndex(-1, 1, 3)).toBe(0);
    expect(nextRowIndex(0, 1, 3)).toBe(1);
    expect(nextRowIndex(2, 1, 3)).toBe(2);
  });

  it('moves up with k, selecting the last row from nothing', () => {
    expect(nextRowIndex(-1, -1, 3)).toBe(2);
    expect(nextRowIndex(2, -1, 3)).toBe(1);
    expect(nextRowIndex(0, -1, 3)).toBe(0);
  });

  it('keeps selection at -1 when no rows exist', () => {
    expect(nextRowIndex(-1, 1, 0)).toBe(-1);
  });
});

describe('locale-safe hrefs', () => {
  it('extracts locale from the pathname', () => {
    expect(extractLocale('/th/contests')).toBe('th');
    expect(extractLocale('/en')).toBe('en');
    expect(extractLocale('/')).toBe('en');
  });

  it('routes through the harness locale, never a literal /en/', () => {
    const h = makeHarness('th');
    handleShortcutEvent(keyEvent('g'), h.deps(), 0);
    handleShortcutEvent(keyEvent('d'), h.deps(), 100);
    expect(h.navigated).toEqual(['/th']);
  });
});

describe('shortcut permission parity', () => {
  it('keeps Admins and Groups independently reachable by their own keys', () => {
    expect(chordRouteIds(['admin:list', 'admin:read'])).toContain('administration.admins');
    expect(chordRouteIds(['admin:list', 'admin:read'])).not.toContain('administration.groups');
    expect(chordRouteIds(['group:list', 'group:read'])).toContain('administration.groups');
    expect(chordRouteIds(['group:list', 'group:read'])).not.toContain('administration.admins');
  });

  it('hides the Administration group when neither list key is granted', () => {
    const ids = chordRouteIds(['settings:list']);
    expect(ids).not.toContain('administration.admins');
    expect(ids).not.toContain('administration.groups');
    expect(ids).not.toContain('administration.audit');
  });

  it('grants the whole shortcut surface through the audited all:all bypass', () => {
    expect(chordRouteIds(ALL_PERMISSIONS).sort()).toEqual(chordRouteIds(undefined).sort());
  });

  it('matches the registry shortcuts surface for the same caller', () => {
    for (const keys of [['contest:list'], ['task:list'], ['user:list'], ['team:list']]) {
      expect(chordRouteIds(keys).sort()).toEqual(
        visibleRoutes(new Set(keys), 'shortcuts')
          .map((route) => route.id)
          .sort(),
      );
    }
  });
});
