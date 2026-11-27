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

/** The ranking console keeps display facts beside a hashed account counter. */
export const RANKING_LOCKOUT_METADATA_NAMESPACE = 'cms:ranking:login-meta:';

/** The metadata key paired with a ranking account counter, or null for an IP key. */
export function rankingMetadataKeyFor(counterKey: string): string | null {
  const entry = lockoutNamespaceFor(counterKey);
  if (entry?.surface !== 'ranking') return null;
  const raw = counterKey.slice(entry.namespace.length);
  if (raw.startsWith('ip#')) return null;
  return `${RANKING_LOCKOUT_METADATA_NAMESPACE}${raw}`;
}

/** The entry a key belongs to, or null when it matches no known namespace. */
export function lockoutNamespaceFor(key: string): LockoutNamespace | null {
  return LOCKOUT_NAMESPACES.find((entry) => isLockoutKey(entry.namespace, key)) ?? null;
}
