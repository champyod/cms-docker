export const THEME_STORAGE_KEY = 'cms-theme';
export const THEME_COOKIE_NAME = 'cms-theme';
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
export const THEME_CHANGE_EVENT = 'cms-theme-change';

/** What the person chose. `system` is a real choice, not the absence of one. */
export type ThemePreference = 'system' | 'light' | 'dark';
/** What is painted; `system` always resolves to one of these. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

const STORED_THEME_PATTERN = new RegExp(
  `(?:^|;\\s*)${THEME_COOKIE_NAME}=(system|light|dark)(?:;|$)`
);

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function resolveTheme(
  stored: string | null | undefined,
  systemPrefersDark: boolean
): ResolvedTheme {
  if (stored === 'light' || stored === 'dark') return stored;
  return systemPrefersDark ? 'dark' : 'light';
}

export function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function readStoredTheme(): ThemePreference | null {
  if (typeof document === 'undefined') return null;
  const cookieMatch = document.cookie.match(STORED_THEME_PATTERN);
  if (cookieMatch && isThemePreference(cookieMatch[1])) return cookieMatch[1];
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : null;
  } catch {
    // Storage can be blocked (private mode); cookie/localStorage absence means OS default.
    return null;
  }
}

/**
 * Paints the resolved theme and records the preference on the root element.
 * The class alone cannot tell `system` apart from an explicit choice that happens to agree
 * with it, so the preference is mirrored in a data attribute and read back by the hook.
 */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference, getSystemPrefersDark());
  if (typeof document === 'undefined') return resolved;
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
  root.dataset.themePreference = preference;
  document.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  return resolved;
}

export function persistTheme(preference: ThemePreference): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Non-critical mirror; cookie below remains the durable store.
  }
  document.cookie = `${THEME_COOKIE_NAME}=${preference}; path=/; max-age=${THEME_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

export function subscribeToTheme(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  document.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => document.removeEventListener(THEME_CHANGE_EVENT, onChange);
}

export function getAppliedTheme(): ResolvedTheme | null {
  if (typeof document === 'undefined') return null;
  const rootClassList = document.documentElement.classList;
  if (rootClassList.contains('dark')) return 'dark';
  if (rootClassList.contains('light')) return 'light';
  return null;
}

/** The stored preference, falling back to `system` when nothing was ever chosen. */
export function getThemePreference(): ThemePreference {
  if (typeof document === 'undefined') return 'system';
  const fromDom: unknown = document.documentElement.dataset.themePreference;
  if (isThemePreference(fromDom)) return fromDom;
  return readStoredTheme() ?? 'system';
}

/** Cycle the three states: follow the system, then force one mode, then back. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  if (current === 'system') return 'light';
  if (current === 'light') return 'dark';
  return 'system';
}

export const NO_FLASH_THEME_SCRIPT = [
  '(function(){try{',
  `var m=document.cookie.match(/(?:^|;\\\\s*)${THEME_COOKIE_NAME}=(system|light|dark)(?:;|$)/);`,
  'var p=m?m[1]:null;',
  `if(!p){try{p=window.localStorage.getItem('${THEME_STORAGE_KEY}')}catch(e){}}`,
  "if(p!=='light'&&p!=='dark'&&p!=='system'){p='system'}",
  "var d=(p==='dark')||(p==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);",
  "var c=document.documentElement.classList;c.remove('light','dark');c.add(d?'dark':'light');",
  'document.documentElement.dataset.themePreference=p;',
  '}catch(e){}})();',
].join('');
