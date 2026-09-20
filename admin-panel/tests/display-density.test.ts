import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DISPLAY,
  DISPLAY_CHANGE_EVENT,
  DENSITY_COOKIE_NAME,
  DENSITY_STORAGE_KEY,
  NO_FLASH_DISPLAY_SCRIPT,
  TEXT_SIZE_COOKIE_NAME,
  TEXT_SIZE_STORAGE_KEY,
  applyDisplay,
  getAppliedDisplay,
  persistDisplay,
  readStoredDisplay,
  resolveDisplay,
  subscribeToDisplay,
} from '@/lib/display-density';

afterEach(() => {
  vi.unstubAllGlobals();
});

function createFakeClassList(initial: string[] = []) {
  const classes = new Set<string>(initial);
  return {
    classes,
    remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
    add: (...names: string[]) => names.forEach((name) => classes.add(name)),
    contains: (name: string) => classes.has(name),
  };
}

describe('resolveDisplay', () => {
  it('keeps valid stored values', () => {
    expect(resolveDisplay({ density: 'compact', textSize: 'large' })).toEqual({
      density: 'compact',
      textSize: 'large',
    });
  });

  it('falls back to defaults for missing or invalid values', () => {
    expect(resolveDisplay({})).toEqual(DEFAULT_DISPLAY);
    expect(resolveDisplay({ density: 'tiny' as never, textSize: 'huge' as never })).toEqual(DEFAULT_DISPLAY);
  });
});

describe('readStoredDisplay', () => {
  it('prefers cookies over localStorage', () => {
    vi.stubGlobal('document', { cookie: `${DENSITY_COOKIE_NAME}=compact; ${TEXT_SIZE_COOKIE_NAME}=large` });
    vi.stubGlobal('window', { localStorage: { getItem: () => 'comfortable' } });
    expect(readStoredDisplay()).toEqual({ density: 'compact', textSize: 'large' });
  });

  it('falls back to localStorage when no cookies exist', () => {
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => (key === DENSITY_STORAGE_KEY ? 'compact' : key === TEXT_SIZE_STORAGE_KEY ? 'small' : null),
      },
    });
    expect(readStoredDisplay()).toEqual({ density: 'compact', textSize: 'small' });
  });
});

describe('applyDisplay', () => {
  it('swaps root classes and notifies subscribers', () => {
    const classList = createFakeClassList(['density-compact', 'text-size-large']);
    const eventTypes: string[] = [];
    vi.stubGlobal('document', {
      documentElement: { classList },
      dispatchEvent: (event: Event) => {
        eventTypes.push(event.type);
        return true;
      },
    });

    applyDisplay({ density: 'comfortable', textSize: 'small' });

    expect(classList.classes.has('density-compact')).toBe(false);
    expect(classList.classes.has('text-size-small')).toBe(true);
    expect(eventTypes).toEqual([DISPLAY_CHANGE_EVENT]);
  });
});

describe('persistDisplay', () => {
  it('writes both localStorage keys and both cookies', () => {
    const setItem = vi.fn();
    const documentStub = { cookie: '' };
    vi.stubGlobal('window', { localStorage: { setItem } });
    vi.stubGlobal('document', documentStub);

    persistDisplay({ density: 'compact', textSize: 'large' });

    expect(setItem).toHaveBeenCalledWith(DENSITY_STORAGE_KEY, 'compact');
    expect(setItem).toHaveBeenCalledWith(TEXT_SIZE_STORAGE_KEY, 'large');
    expect(documentStub.cookie).toContain(`${TEXT_SIZE_COOKIE_NAME}=large`);
  });
});

describe('getAppliedDisplay', () => {
  it('reads density and text size from root classes', () => {
    vi.stubGlobal('document', {
      documentElement: { classList: createFakeClassList(['density-compact', 'text-size-large']) },
    });
    expect(getAppliedDisplay()).toEqual({ density: 'compact', textSize: 'large' });
  });

  it('defaults to comfortable medium without state classes', () => {
    vi.stubGlobal('document', { documentElement: { classList: createFakeClassList([]) } });
    expect(getAppliedDisplay()).toEqual({ density: 'comfortable', textSize: 'medium' });
  });
});

describe('subscribeToDisplay', () => {
  it('adds and removes the change listener', () => {
    const listeners = new Set<unknown>();
    vi.stubGlobal('document', {
      addEventListener: (_type: string, listener: unknown) => listeners.add(listener),
      removeEventListener: (_type: string, listener: unknown) => listeners.delete(listener),
    });

    const onChange = (): void => undefined;
    const unsubscribe = subscribeToDisplay(onChange);

    expect(listeners.has(onChange)).toBe(true);

    unsubscribe();

    expect(listeners.has(onChange)).toBe(false);
  });
});

describe('NO_FLASH_DISPLAY_SCRIPT', () => {
  it('checks every persistence layer before paint', () => {
    expect(NO_FLASH_DISPLAY_SCRIPT).toContain(DENSITY_COOKIE_NAME);
    expect(NO_FLASH_DISPLAY_SCRIPT).toContain(TEXT_SIZE_COOKIE_NAME);
    expect(NO_FLASH_DISPLAY_SCRIPT).toContain('density-compact');
    expect(NO_FLASH_DISPLAY_SCRIPT).toContain('text-size-');
  });

  it('is an IIFE so it executes immediately when injected', () => {
    expect(NO_FLASH_DISPLAY_SCRIPT.startsWith('(function()')).toBe(true);
    expect(NO_FLASH_DISPLAY_SCRIPT.endsWith('})();')).toBe(true);
  });
});
