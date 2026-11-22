import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyContrast,
  getContrastPreference,
  NO_FLASH_THEME_SCRIPT,
  persistContrast,
  subscribeToContrast,
} from '@/lib/theme';

function stubDocument() {
  const classList = {
    _set: new Set<string>(),
    add(...names: string[]) {
      names.forEach((name) => this._set.add(name));
    },
    remove(...names: string[]) {
      names.forEach((name) => this._set.delete(name));
    },
    toggle(name: string, force?: boolean) {
      const next = force ?? !this._set.has(name);
      if (next) this._set.add(name);
      else this._set.delete(name);
      return next;
    },
    contains(name: string) {
      return this._set.has(name);
    },
  };
  const dataset: Record<string, string> = {};
  const listeners = new Map<string, Set<() => void>>();
  const documentElement = { classList, dataset };
  vi.stubGlobal('document', {
    documentElement,
    cookie: '',
    addEventListener: (event: string, handler: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(handler);
    },
    removeEventListener: (event: string, handler: () => void) => {
      listeners.get(event)?.delete(handler);
    },
    dispatchEvent: (event: { type: string }) => {
      listeners.get(event.type)?.forEach((handler) => handler());
      return true;
    },
  });
  vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => undefined } });
  vi.stubGlobal('Event', class {
    constructor(readonly type: string) {}
  });
  return { classList, dataset };
}

describe('contrast axis', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('paints high contrast as a class on the root element, not as a theme', () => {
    const { classList, dataset } = stubDocument();

    applyContrast('high');

    expect(classList.contains('high-contrast')).toBe(true);
    expect(dataset.contrast).toBe('high');
  });

  it('turns the class off again, so the choice is reversible', () => {
    const { classList } = stubDocument();

    applyContrast('high');
    applyContrast('normal');

    expect(classList.contains('high-contrast')).toBe(false);
  });

  it('stores the choice in a cookie, and applying it notifies subscribers', () => {
    stubDocument();
    const seen = vi.fn();
    const unsubscribe = subscribeToContrast(seen);

    persistContrast('high');
    expect(document.cookie).toContain('cms-contrast=high');
    // Persisting is storage only; painting is what subscribers hear about.
    expect(seen).not.toHaveBeenCalled();

    applyContrast('high');
    expect(seen).toHaveBeenCalled();
    unsubscribe();
  });

  it('reads back what was applied, and defaults to normal', () => {
    const { dataset } = stubDocument();

    expect(getContrastPreference()).toBe('normal');
    dataset.contrast = 'high';
    expect(getContrastPreference()).toBe('high');
  });

  it('paints contrast before the first frame, so the palette never flashes', () => {
    expect(NO_FLASH_THEME_SCRIPT).toContain("classList.toggle('high-contrast'");
    expect(NO_FLASH_THEME_SCRIPT).toContain('cms-contrast');
  });
});
