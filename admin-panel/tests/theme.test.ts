import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NO_FLASH_THEME_SCRIPT,
  THEME_CHANGE_EVENT,
  THEME_COOKIE_NAME,
  THEME_STORAGE_KEY,
  applyTheme,
  getAppliedTheme,
  getSystemPrefersDark,
  persistTheme,
  readStoredTheme,
  resolveTheme,
  subscribeToTheme,
} from '@/lib/theme';

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

describe('resolveTheme', () => {
  it('returns the stored light preference', () => {
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('returns the stored dark preference', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('falls back to system dark when nothing is stored', () => {
    expect(resolveTheme(null, true)).toBe('dark');
  });

  it('falls back to system light when nothing is stored', () => {
    expect(resolveTheme(undefined, false)).toBe('light');
  });

  it('ignores invalid stored values and uses the OS preference', () => {
    expect(resolveTheme('blue', true)).toBe('dark');
    expect(resolveTheme('', false)).toBe('light');
  });
});

describe('getSystemPrefersDark', () => {
  it('reads prefers-color-scheme dark from matchMedia', () => {
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({ matches: query.includes('dark') }),
    });
    expect(getSystemPrefersDark()).toBe(true);
  });

  it('reads prefers-color-scheme light from matchMedia', () => {
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({ matches: !query.includes('dark') }),
    });
    expect(getSystemPrefersDark()).toBe(false);
  });

  it('defaults to dark outside the browser', () => {
    expect(getSystemPrefersDark()).toBe(true);
  });
});

describe('readStoredTheme', () => {
  it('prefers the cookie over localStorage', () => {
    vi.stubGlobal('document', { cookie: 'other=1; cms-theme=light; session=x' });
    vi.stubGlobal('window', { localStorage: { getItem: () => 'dark' } });
    expect(readStoredTheme()).toBe('light');
  });

  it('falls back to localStorage when no theme cookie exists', () => {
    vi.stubGlobal('document', { cookie: 'other=1' });
    vi.stubGlobal('window', { localStorage: { getItem: () => 'dark' } });
    expect(readStoredTheme()).toBe('dark');
  });

  it('returns null when nothing is persisted', () => {
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('window', { localStorage: { getItem: () => null } });
    expect(readStoredTheme()).toBe(null);
  });
});

describe('persistTheme', () => {
  it('writes both localStorage and the cookie', () => {
    const setItem = vi.fn();
    const documentStub = { cookie: '' };
    vi.stubGlobal('window', { localStorage: { setItem } });
    vi.stubGlobal('document', documentStub);

    persistTheme('dark');

    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'dark');
    expect(documentStub.cookie).toContain(`${THEME_COOKIE_NAME}=dark`);
    expect(documentStub.cookie).toContain('max-age=');
  });

  it('overwrites a previous cookie value', () => {
    const setItem = vi.fn();
    const documentStub = { cookie: `${THEME_COOKIE_NAME}=light` };
    vi.stubGlobal('window', { localStorage: { setItem } });
    vi.stubGlobal('document', documentStub);

    persistTheme('dark');

    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'dark');
    expect(documentStub.cookie).toContain(`${THEME_COOKIE_NAME}=dark`);
  });
});

describe('applyTheme', () => {
  it('swaps the root class and notifies subscribers', () => {
    const classList = createFakeClassList(['dark']);
    const eventTypes: string[] = [];
    vi.stubGlobal('document', {
      documentElement: { classList },
      dispatchEvent: (event: Event) => {
        eventTypes.push(event.type);
        return true;
      },
    });

    applyTheme('light');

    expect(classList.classes.has('light')).toBe(true);
    expect(classList.classes.has('dark')).toBe(false);
    expect(eventTypes).toEqual([THEME_CHANGE_EVENT]);
  });
});

describe('getAppliedTheme', () => {
  it('returns dark when only the dark class is present', () => {
    vi.stubGlobal('document', { documentElement: { classList: createFakeClassList(['dark']) } });
    expect(getAppliedTheme()).toBe('dark');
  });

  it('returns light when only the light class is present', () => {
    vi.stubGlobal('document', { documentElement: { classList: createFakeClassList(['light']) } });
    expect(getAppliedTheme()).toBe('light');
  });

  it('returns null before the no-flash script runs', () => {
    vi.stubGlobal('document', { documentElement: { classList: createFakeClassList([]) } });
    expect(getAppliedTheme()).toBe(null);
  });
});

describe('subscribeToTheme', () => {
  it('adds and removes the change listener', () => {
    const listeners = new Set<unknown>();
    vi.stubGlobal('document', {
      addEventListener: (_type: string, listener: unknown) => listeners.add(listener),
      removeEventListener: (_type: string, listener: unknown) => listeners.delete(listener),
    });

    const onChange = (): void => undefined;
    const unsubscribe = subscribeToTheme(onChange);

    expect(listeners.has(onChange)).toBe(true);

    unsubscribe();

    expect(listeners.has(onChange)).toBe(false);
  });
});

describe('NO_FLASH_THEME_SCRIPT', () => {
  it('checks every persistence layer before paint', () => {
    expect(NO_FLASH_THEME_SCRIPT).toContain(THEME_COOKIE_NAME);
    expect(NO_FLASH_THEME_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(NO_FLASH_THEME_SCRIPT).toContain('prefers-color-scheme');
    expect(NO_FLASH_THEME_SCRIPT).toContain("c.add(t)");
  });

  it('is an IIFE so it executes immediately when injected', () => {
    expect(NO_FLASH_THEME_SCRIPT.startsWith('(function()')).toBe(true);
    expect(NO_FLASH_THEME_SCRIPT.endsWith('})();')).toBe(true);
  });
});
