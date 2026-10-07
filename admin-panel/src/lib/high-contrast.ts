export const HIGH_CONTRAST_STORAGE_KEY = 'cms-high-contrast';
export const HIGH_CONTRAST_COOKIE_NAME = 'cms-high-contrast';
export const HIGH_CONTRAST_CHANGE_EVENT = 'cms-high-contrast-change';
export const HIGH_CONTRAST_CLASS = 'high-contrast';

export type ContrastPreference = 'standard' | 'high';

const STORED_CONTRAST_PATTERN = new RegExp(
  `(?:^|;\\s*)${HIGH_CONTRAST_COOKIE_NAME}=(standard|high)(?:;|$)`
);

const CONTRAST_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function resolveHighContrast(stored: string | null | undefined): ContrastPreference {
  return stored === 'high' ? 'high' : 'standard';
}

export function readStoredHighContrast(): string | null {
  if (typeof document === 'undefined') return null;
  const cookieMatch = document.cookie.match(STORED_CONTRAST_PATTERN);
  if (cookieMatch) return cookieMatch[1];
  try {
    return window.localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY);
  } catch {
    // Storage can be blocked (private mode); absence means the standard default.
    return null;
  }
}

export function applyHighContrast(preference: ContrastPreference): void {
  if (typeof document === 'undefined') return;
  const rootClassList = document.documentElement.classList;
  if (preference === 'high') rootClassList.add(HIGH_CONTRAST_CLASS);
  else rootClassList.remove(HIGH_CONTRAST_CLASS);
  document.dispatchEvent(new Event(HIGH_CONTRAST_CHANGE_EVENT));
}

export function persistHighContrast(preference: ContrastPreference): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, preference);
  } catch {
    // Non-critical mirror; the cookie below remains the durable store.
  }
  document.cookie = `${HIGH_CONTRAST_COOKIE_NAME}=${preference}; path=/; max-age=${CONTRAST_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

export function subscribeToHighContrast(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  document.addEventListener(HIGH_CONTRAST_CHANGE_EVENT, onChange);
  return () => document.removeEventListener(HIGH_CONTRAST_CHANGE_EVENT, onChange);
}

export function getAppliedHighContrast(): boolean | null {
  if (typeof document === 'undefined') return null;
  return document.documentElement.classList.contains(HIGH_CONTRAST_CLASS);
}

export const NO_FLASH_HIGH_CONTRAST_SCRIPT = [
  '(function(){try{',
  `var m=document.cookie.match(/(?:^|;\\s*)${HIGH_CONTRAST_COOKIE_NAME}=(standard|high)(?:;|$)/);`,
  'var p=m?m[1]:null;',
  `if(!p){try{p=window.localStorage.getItem('${HIGH_CONTRAST_STORAGE_KEY}')}catch(e){}}`,
  `if(p==='high'){document.documentElement.classList.add('${HIGH_CONTRAST_CLASS}')}`,
  '}catch(e){}})();',
].join('');
