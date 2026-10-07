export const DENSITY_STORAGE_KEY = 'cms-density';
export const DENSITY_COOKIE_NAME = 'cms-density';
export const TEXT_SIZE_STORAGE_KEY = 'cms-text-size';
export const TEXT_SIZE_COOKIE_NAME = 'cms-text-size';
export const DISPLAY_CHANGE_EVENT = 'cms-display-change';

export type DensityPreference = 'comfortable' | 'compact';
export type TextSizePreference = 'small' | 'medium' | 'large';

export interface DisplayPreferences {
  density: DensityPreference;
  textSize: TextSizePreference;
}

export const DEFAULT_DISPLAY: DisplayPreferences = { density: 'comfortable', textSize: 'medium' };

const DENSITY_PATTERN = new RegExp(`(?:^|;\\s*)${DENSITY_COOKIE_NAME}=(comfortable|compact)(?:;|$)`);
const TEXT_SIZE_PATTERN = new RegExp(`(?:^|;\\s*)${TEXT_SIZE_COOKIE_NAME}=(small|medium|large)(?:;|$)`);

function isDensity(value: unknown): value is DensityPreference {
  return value === 'comfortable' || value === 'compact';
}

function isTextSize(value: unknown): value is TextSizePreference {
  return value === 'small' || value === 'medium' || value === 'large';
}

export function resolveDisplay(stored: Partial<DisplayPreferences>): DisplayPreferences {
  return {
    density: isDensity(stored.density) ? stored.density : DEFAULT_DISPLAY.density,
    textSize: isTextSize(stored.textSize) ? stored.textSize : DEFAULT_DISPLAY.textSize,
  };
}

export function readStoredDisplay(): Partial<DisplayPreferences> {
  if (typeof document === 'undefined') return {};
  const densityMatch = document.cookie.match(DENSITY_PATTERN);
  const textSizeMatch = document.cookie.match(TEXT_SIZE_PATTERN);
  const stored: Partial<DisplayPreferences> = {};
  if (densityMatch) stored.density = densityMatch[1] as DensityPreference;
  if (textSizeMatch) stored.textSize = textSizeMatch[1] as TextSizePreference;
  try {
    if (!stored.density) {
      const raw = window.localStorage.getItem(DENSITY_STORAGE_KEY);
      if (isDensity(raw)) stored.density = raw;
    }
    if (!stored.textSize) {
      const raw = window.localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
      if (isTextSize(raw)) stored.textSize = raw;
    }
  } catch {
    // Storage can be blocked (private mode); cookie absence means defaults.
  }
  return stored;
}

const DENSITY_CLASSES: readonly string[] = ['density-compact'];
const TEXT_SIZE_CLASSES: readonly string[] = ['text-size-small', 'text-size-medium', 'text-size-large'];

export function applyDisplay(preferences: DisplayPreferences): void {
  if (typeof document === 'undefined') return;
  const rootClassList = document.documentElement.classList;
  rootClassList.remove(...DENSITY_CLASSES, ...TEXT_SIZE_CLASSES);
  if (preferences.density === 'compact') rootClassList.add('density-compact');
  rootClassList.add(`text-size-${preferences.textSize}`);
  document.dispatchEvent(new Event(DISPLAY_CHANGE_EVENT));
}

const DISPLAY_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function persistValue(name: string, key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Non-critical mirror; cookie below remains the durable store.
  }
  document.cookie = `${name}=${value}; path=/; max-age=${DISPLAY_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

export function persistDisplay(preferences: DisplayPreferences): void {
  if (typeof window === 'undefined') return;
  persistValue(DENSITY_COOKIE_NAME, DENSITY_STORAGE_KEY, preferences.density);
  persistValue(TEXT_SIZE_COOKIE_NAME, TEXT_SIZE_STORAGE_KEY, preferences.textSize);
}

export function subscribeToDisplay(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  document.addEventListener(DISPLAY_CHANGE_EVENT, onChange);
  return () => document.removeEventListener(DISPLAY_CHANGE_EVENT, onChange);
}

// Why cached: useSyncExternalStore re-renders whenever getSnapshot returns a
// new reference; a fresh object per call would loop forever (React error #185).
let cachedDisplay: DisplayPreferences | null = null;

export function getAppliedDisplay(): DisplayPreferences | null {
  if (typeof document === 'undefined') return null;
  const rootClassList = document.documentElement.classList;
  const density: DensityPreference = rootClassList.contains('density-compact') ? 'compact' : 'comfortable';
  const textSize: TextSizePreference = rootClassList.contains('text-size-small')
    ? 'small'
    : rootClassList.contains('text-size-large')
      ? 'large'
      : 'medium';
  if (
    cachedDisplay !== null &&
    cachedDisplay.density === density &&
    cachedDisplay.textSize === textSize
  ) {
    return cachedDisplay;
  }
  cachedDisplay = { density, textSize };
  return cachedDisplay;
}

export const NO_FLASH_DISPLAY_SCRIPT = [
  '(function(){try{',
  `var dm=document.cookie.match(/(?:^|;\\s*)${DENSITY_COOKIE_NAME}=(comfortable|compact)(?:;|$)/);`,
  'var d=dm?dm[1]:null;',
  `if(!d){try{d=window.localStorage.getItem('${DENSITY_STORAGE_KEY}')}catch(e){}}`,
  "if(d!=='compact'){d='comfortable'}",
  `var tm=document.cookie.match(/(?:^|;\\s*)${TEXT_SIZE_COOKIE_NAME}=(small|medium|large)(?:;|$)/);`,
  'var t=tm?tm[1]:null;',
  `if(!t){try{t=window.localStorage.getItem('${TEXT_SIZE_STORAGE_KEY}')}catch(e){}}`,
  "if(t!=='small'&&t!=='large'){t='medium'}",
  "var c=document.documentElement.classList;if(d==='compact'){c.add('density-compact')}",
  "c.add('text-size-'+t)",
  '}catch(e){}})();',
].join('');
