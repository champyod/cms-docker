import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HIGH_CONTRAST_CHANGE_EVENT,
  HIGH_CONTRAST_CLASS,
  HIGH_CONTRAST_COOKIE_NAME,
  HIGH_CONTRAST_STORAGE_KEY,
  NO_FLASH_HIGH_CONTRAST_SCRIPT,
  applyHighContrast,
  getAppliedHighContrast,
  persistHighContrast,
  readStoredHighContrast,
  resolveHighContrast,
  subscribeToHighContrast,
} from '@/lib/high-contrast';

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

describe('resolveHighContrast', () => {
  it('maps only the stored high value to high', () => {
    expect(resolveHighContrast('high')).toBe('high');
    expect(resolveHighContrast('standard')).toBe('standard');
    expect(resolveHighContrast(null)).toBe('standard');
    expect(resolveHighContrast('bogus')).toBe('standard');
  });
});

describe('readStoredHighContrast', () => {
  it('prefers the cookie over localStorage', () => {
    vi.stubGlobal('document', { cookie: `${HIGH_CONTRAST_COOKIE_NAME}=high` });
    vi.stubGlobal('window', { localStorage: { getItem: () => 'standard' } });
    expect(readStoredHighContrast()).toBe('high');
  });

  it('falls back to localStorage when no cookie exists', () => {
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('window', { localStorage: { getItem: () => 'high' } });
    expect(readStoredHighContrast()).toBe('high');
  });
});

describe('applyHighContrast', () => {
  it('adds the root class and notifies subscribers for high', () => {
    const classList = createFakeClassList([]);
    const eventTypes: string[] = [];
    vi.stubGlobal('document', {
      documentElement: { classList },
      dispatchEvent: (event: Event) => {
        eventTypes.push(event.type);
        return true;
      },
    });

    applyHighContrast('high');

    expect(classList.classes.has(HIGH_CONTRAST_CLASS)).toBe(true);
    expect(eventTypes).toEqual([HIGH_CONTRAST_CHANGE_EVENT]);
  });

  it('removes the root class for standard', () => {
    const classList = createFakeClassList([HIGH_CONTRAST_CLASS]);
    vi.stubGlobal('document', { documentElement: { classList }, dispatchEvent: () => true });

    applyHighContrast('standard');

    expect(classList.classes.has(HIGH_CONTRAST_CLASS)).toBe(false);
  });
});

describe('persistHighContrast', () => {
  it('writes localStorage and the cookie', () => {
    const setItem = vi.fn();
    const documentStub = { cookie: '' };
    vi.stubGlobal('window', { localStorage: { setItem } });
    vi.stubGlobal('document', documentStub);

    persistHighContrast('high');

    expect(setItem).toHaveBeenCalledWith(HIGH_CONTRAST_STORAGE_KEY, 'high');
    expect(documentStub.cookie).toContain(`${HIGH_CONTRAST_COOKIE_NAME}=high`);
  });
});

describe('getAppliedHighContrast', () => {
  it('reads the flag from the root class', () => {
    vi.stubGlobal('document', {
      documentElement: { classList: createFakeClassList([HIGH_CONTRAST_CLASS]) },
    });
    expect(getAppliedHighContrast()).toBe(true);
  });

  it('reports false when the class is absent', () => {
    vi.stubGlobal('document', { documentElement: { classList: createFakeClassList([]) } });
    expect(getAppliedHighContrast()).toBe(false);
  });
});

describe('subscribeToHighContrast', () => {
  it('adds and removes the change listener', () => {
    const listeners = new Set<unknown>();
    vi.stubGlobal('document', {
      addEventListener: (_type: string, listener: unknown) => listeners.add(listener),
      removeEventListener: (_type: string, listener: unknown) => listeners.delete(listener),
    });

    const onChange = (): void => undefined;
    const unsubscribe = subscribeToHighContrast(onChange);

    expect(listeners.has(onChange)).toBe(true);

    unsubscribe();

    expect(listeners.has(onChange)).toBe(false);
  });
});

describe('NO_FLASH_HIGH_CONTRAST_SCRIPT', () => {
  it('checks every persistence layer before paint', () => {
    expect(NO_FLASH_HIGH_CONTRAST_SCRIPT).toContain(HIGH_CONTRAST_COOKIE_NAME);
    expect(NO_FLASH_HIGH_CONTRAST_SCRIPT).toContain(HIGH_CONTRAST_STORAGE_KEY);
    expect(NO_FLASH_HIGH_CONTRAST_SCRIPT).toContain(HIGH_CONTRAST_CLASS);
  });

  it('is an IIFE so it executes immediately when injected', () => {
    expect(NO_FLASH_HIGH_CONTRAST_SCRIPT.startsWith('(function()')).toBe(true);
    expect(NO_FLASH_HIGH_CONTRAST_SCRIPT.endsWith('})();')).toBe(true);
  });
});
