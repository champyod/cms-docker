/**
 * A `localStorage` stand-in for the browser suites.
 *
 * Why: happy-dom leaves the storage accessors undefined on an opaque origin, and the panel's client
 * stores read `window.localStorage` directly — a suite that needs a value to survive a remount
 * supplies this store through `vi.stubGlobal('localStorage', memoryStorage())`.
 */
export function memoryStorage(): Storage {
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
