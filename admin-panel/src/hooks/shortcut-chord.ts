'use client';

import { visibleRoutes } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';

/**
 * The `g`-chord half of the shortcut layer: which key opens which frozen route.
 *
 * Why its own module, and why it imports nothing from the shell: the chord is
 * keyboard metadata plus a registry gate, nothing more. Its label and href are
 * presentation, and the one component that renders a chord list joins them itself —
 * so no module under `hooks/` has to reach into `components/` to know a label.
 */

export const CHORD_TIMEOUT_MS = 1000;
export const CHORD_PREFIX_KEY = 'g';

/**
 * Why a map and not a registry field: a key binding is a local affordance of the
 * shortcut layer, so it must not widen the descriptor shape or become a second
 * place a path or a permission is declared. Every entry here is a `RouteId`; the
 * href and the gate both come from the registry at read time.
 *
 * Why Admins takes `a` and Groups takes `h`: the old single Permissions entry kept
 * `a` because the chord operators already knew it for admin management, and `g`
 * cannot be a destination because it is the chord prefix itself. `h` is the next
 * free letter, and every key here also avoids `j`/`k`, which belong to row
 * selection, and `?`, which toggles the overlay.
 */
const CHORD_KEY_BY_ROUTE: ReadonlyMap<RouteId, string> = new Map<RouteId, string>([
  ['home', 'd'],
  ['contests.list', 'c'],
  ['tasks.list', 't'],
  ['evaluation.submissions', 's'],
  ['evaluation.lanes', 'l'],
  ['people.users', 'u'],
  ['people.teams', 'm'],
  ['infrastructure.deployments', 'p'],
  ['administration.admins', 'a'],
  ['administration.groups', 'h'],
  ['administration.audit', 'i'],
  ['infrastructure.resources', 'r'],
  ['infrastructure.containers', 'o'],
  ['infrastructure.ranking', 'n'],
  ['system.appearance', 'v'],
  ['system.maintenance', 'w'],
  ['system.settings', 'e'],
  ['system.docs', 'b'],
  ['system.search', 'f'],
]);

// Why an id is carried alongside the key: `bindingsForPermissions` filters the
// chord per caller, and resolving the href needs the frozen route id rather than
// a path string the layer would have to reverse-parse.
export interface ChordEntry {
  readonly key: string;
  readonly routeId: RouteId;
}

const CHORD_ENTRIES: readonly ChordEntry[] = [...CHORD_KEY_BY_ROUTE].map(
  ([routeId, key]) => ({ key, routeId }),
);

export const CHORD_ENTRIES_BY_KEY: ReadonlyMap<string, ChordEntry> = new Map(
  CHORD_ENTRIES.map((entry) => [entry.key, entry]),
);

export interface ChordState {
  readonly pendingKey: string | null;
  readonly startedAt: number;
}

export type ChordDecision =
  | { readonly action: 'pending' }
  | { readonly action: 'navigate'; readonly routeId: RouteId }
  | { readonly action: 'reset' }
  | { readonly action: 'none' };

export const IDLE_CHORD: ChordState = { pendingKey: null, startedAt: 0 };

export function advanceChord(
  state: ChordState,
  key: string,
  now: number,
  byKey: ReadonlyMap<string, ChordEntry> = CHORD_ENTRIES_BY_KEY,
): { state: ChordState; decision: ChordDecision } {
  if (key === CHORD_PREFIX_KEY) {
    return {
      state: { pendingKey: CHORD_PREFIX_KEY, startedAt: now },
      decision: { action: 'pending' },
    };
  }
  if (state.pendingKey !== CHORD_PREFIX_KEY) {
    return { state: IDLE_CHORD, decision: { action: 'none' } };
  }
  if (now - state.startedAt > CHORD_TIMEOUT_MS) {
    return { state: IDLE_CHORD, decision: { action: 'reset' } };
  }
  const entry = byKey.get(key);
  if (!entry) {
    return { state: IDLE_CHORD, decision: { action: 'reset' } };
  }
  return { state: IDLE_CHORD, decision: { action: 'navigate', routeId: entry.routeId } };
}

/**
 * The permitted `g`-chord destinations for one reader.
 *
 * Why filtered here: a chord navigates straight to a page, so an unfiltered chord
 * would reach pages the sidebar already hides. The gate is the registry's own
 * `shortcuts` surface, so a chord can never reach a destination another surface
 * has declared private.
 */
export function bindingsForPermissions(
  permissionKeys: readonly string[] | undefined,
): readonly ChordEntry[] {
  if (permissionKeys === undefined) return CHORD_ENTRIES;
  const permitted = new Set(
    visibleRoutes(new Set(permissionKeys), 'shortcuts').map((route) => route.id),
  );
  return CHORD_ENTRIES.filter((entry) => permitted.has(entry.routeId));
}
