import { isLockoutKey } from '@/lib/redis-lockouts';

// The login surface a namespace belongs to; each surface's label is a dictionary concern.
export type LockoutSurface = 'contest' | 'ranking';

export interface LockoutNamespace {
  readonly namespace: string;
  readonly surface: LockoutSurface;
}

// Every failure counter namespace the deployment keeps, one per login surface. The
// contest and admin servers share the first; the Rust ranking console owns the second.
export const LOCKOUT_NAMESPACES: readonly LockoutNamespace[] = [
  { namespace: 'cms:login:', surface: 'contest' },
  { namespace: 'cms:ranking:login:', surface: 'ranking' },
];

/** The entry a key belongs to, or null when it matches no known namespace. */
export function lockoutNamespaceFor(key: string): LockoutNamespace | null {
  return LOCKOUT_NAMESPACES.find((entry) => isLockoutKey(entry.namespace, key)) ?? null;
}
