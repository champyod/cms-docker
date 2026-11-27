export const THEME_STORAGE_KEY = 'cms-theme';
export const THEME_COOKIE_NAME = 'cms-theme';
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
export const THEME_CHANGE_EVENT = 'cms-theme-change';

export type ThemePreference = 'light' | 'dark';

const STORED_THEME_PATTERN = new RegExp(
  `(?:^|;\\s*)${THEME_COOKIE_NAME}=(light|dark)(?:;|$)`
);

export function resolveTheme(
  stored: string | null | undefined,
  systemPrefersDark: boolean
): ThemePreference {
  if (stored === 'light' || stored === 'dark') return stored;
  return systemPrefersDark ? 'dark' : 'light';
}

export function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function readStoredTheme(): string | null {
  if (typeof document === 'undefined') return null;
  const cookieMatch = document.cookie.match(STORED_THEME_PATTERN);
  if (cookieMatch) return cookieMatch[1];
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Storage can be blocked (private mode); cookie/localStorage absence means OS default.
    return null;
  }
}

export function applyTheme(theme: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const rootClassList = document.documentElement.classList;
  rootClassList.remove('light', 'dark');
  rootClassList.add(theme);
  document.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function persistTheme(theme: ThemePreference): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Non-critical mirror; cookie below remains the durable store.
  }
  document.cookie = `${THEME_COOKIE_NAME}=${theme}; path=/; max-age=${THEME_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

export function subscribeToTheme(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  document.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => document.removeEventListener(THEME_CHANGE_EVENT, onChange);
}

export function getAppliedTheme(): ThemePreference | null {
  if (typeof document === 'undefined') return null;
  const rootClassList = document.documentElement.classList;
  if (rootClassList.contains('dark')) return 'dark';
  if (rootClassList.contains('light')) return 'light';
  return null;
}

export const NO_FLASH_THEME_SCRIPT = [
  '(function(){try{',
  `var m=document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE_NAME}=(light|dark)(?:;|$)/);`,
  'var t=m?m[1]:null;',
  `if(!t){try{t=window.localStorage.getItem('${THEME_STORAGE_KEY}')}catch(e){}}`,
  `if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}`,
  "var c=document.documentElement.classList;c.remove('light','dark');c.add(t)",
  '}catch(e){}})();',
].join('');
