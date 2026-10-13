import type { Dictionary } from '@/lib/dictionary';
import { isLockoutKey } from '@/lib/redis-lockouts';

// The surface a namespace belongs to, and the dictionary key its label is read from.
export type LockoutSurface = keyof Dictionary['ranking']['lockouts']['surfaces'];

export interface LockoutNamespace {
  readonly namespace: string;
  readonly label: LockoutSurface;
}

// Every failure counter namespace the deployment keeps, one per login surface. The
// contest and admin servers share the first; the Rust ranking console owns the second.
export const LOCKOUT_NAMESPACES: readonly LockoutNamespace[] = [
  { namespace: 'cms:login:', label: 'contest' },
  { namespace: 'cms:ranking:login:', label: 'ranking' },
];

/** The entry a key belongs to, or null when it matches no known namespace. */
export function lockoutNamespaceFor(key: string): LockoutNamespace | null {
  return LOCKOUT_NAMESPACES.find((entry) => isLockoutKey(entry.namespace, key)) ?? null;
}
