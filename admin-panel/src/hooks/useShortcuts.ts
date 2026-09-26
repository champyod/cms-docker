'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAppRouter } from './useAppRouter';
import { useDictionary } from '@/hooks/useDictionary';
import { shellItemLabel } from '@/components/navigation/shell-nav';
import { buildRoute } from '@/lib/navigation/routes';
import { visibleRoutes } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';

export const CHORD_TIMEOUT_MS = 1000;
export const CHORD_PREFIX_KEY = 'g';
export const OVERLAY_TOGGLE_KEY = '?';
export const SHORTCUT_ROW_ATTRIBUTE = 'data-shortcut-row';
export const ROW_SELECTED_CLASSES = ['ring-2', 'ring-ring/70', 'ring-inset', 'bg-accent/40'] as const;

/**
 * Keyboard metadata only: which `g`-chord key opens which frozen route.
 *
 * Why a map and not a registry field: a key binding is a local affordance of the
 * shortcut hook, so it must not widen the descriptor shape or become a second
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

export interface ShortcutRouteBinding {
  readonly key: string;
  readonly label: string;
  readonly href: string;
}

// Why an id is carried alongside the key: `bindingsForPermissions` filters the
// chord per caller, and resolving the href needs the frozen route id rather than
// a path string the hook would have to reverse-parse.
export interface ChordEntry {
  readonly key: string;
  readonly routeId: RouteId;
}

const CHORD_ENTRIES: readonly ChordEntry[] = [...CHORD_KEY_BY_ROUTE].map(
  ([routeId, key]) => ({ key, routeId }),
);

const CHORD_ENTRIES_BY_KEY: ReadonlyMap<string, ChordEntry> = new Map(
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

export interface ShortcutKeyEvent {
  readonly key: string;
  readonly defaultPrevented: boolean;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly target: unknown;
  preventDefault(): void;
}

export interface ShortcutHandlerDeps {
  navigate: (href: string) => void;
  getLocale: () => string;
  isOverlayOpen: () => boolean;
  toggleOverlay: () => void;
  chordState: { current: ChordState };
  selectedRowIndex: { current: number };
  chordByKey?: ReadonlyMap<string, ChordEntry>;
}

export function extractLocale(pathname: string): string {
  return pathname.split('/')[1] || 'en';
}

export function isEditableTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true
  );
}

export function clampRowIndex(index: number, rowCount: number): number {
  if (rowCount <= 0) return -1;
  if (index < 0) return 0;
  if (index >= rowCount) return rowCount - 1;
  return index;
}

export function nextRowIndex(current: number, direction: 1 | -1, rowCount: number): number {
  if (rowCount <= 0) return -1;
  if (current < 0) return direction === 1 ? 0 : rowCount - 1;
  return clampRowIndex(current + direction, rowCount);
}

export function advanceChord(
  state: ChordState,
  key: string,
  now: number,
  byKey: ReadonlyMap<string, ChordEntry> = CHORD_ENTRIES_BY_KEY
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

export function handleShortcutEvent(
  event: ShortcutKeyEvent,
  deps: ShortcutHandlerDeps,
  now: number = Date.now()
): void {
  if (event.defaultPrevented || hasModifier(event)) return;
  if (isEditableTarget(event.target)) return;

  if (event.key === OVERLAY_TOGGLE_KEY) {
    event.preventDefault();
    deps.toggleOverlay();
    return;
  }
  if (deps.isOverlayOpen()) return;

  if (event.key === 'j' || event.key === 'k') {
    event.preventDefault();
    moveRowSelection(event.key === 'j' ? 1 : -1, deps.selectedRowIndex);
    return;
  }
  if (event.key === 'Enter') {
    activateSelectedRow(event, deps.selectedRowIndex);
    return;
  }

  const result = advanceChord(deps.chordState.current, event.key, now, deps.chordByKey);
  deps.chordState.current = result.state;
  if (result.decision.action === 'navigate') {
    event.preventDefault();
    deps.navigate(buildRoute(deps.getLocale(), result.decision.routeId));
  }
}

// Why filtered here: a chord navigates straight to a page, so an unfiltered chord
// would reach pages the sidebar already hides. The gate is the registry's own
// `shortcuts` surface, so a chord can never reach a destination another surface
// has declared private.
export function bindingsForPermissions(
  permissionKeys: readonly string[] | undefined,
): readonly ChordEntry[] {
  if (permissionKeys === undefined) return CHORD_ENTRIES;
  const permitted = new Set(
    visibleRoutes(new Set(permissionKeys), 'shortcuts').map((route) => route.id),
  );
  return CHORD_ENTRIES.filter((entry) => permitted.has(entry.routeId));
}

/**
 * The permitted `g`-chord destinations, labelled and linked.
 *
 * Why a hook: the key list is local metadata, but its label and href come from the
 * frozen registry, and a client component may only read the dictionary through the
 * provider hook — so the join happens here rather than in each consumer.
 */
export function useShortcutBindings(
  permissionKeys: readonly string[] | undefined,
): readonly ShortcutRouteBinding[] {
  const dictionary = useDictionary();
  const locale = extractLocale(usePathname() ?? '');
  return useMemo(
    () =>
      bindingsForPermissions(permissionKeys).map((entry) => ({
        key: entry.key,
        label: shellItemLabel(dictionary, entry.routeId),
        href: buildRoute(locale, entry.routeId),
      })),
    [permissionKeys, locale, dictionary],
  );
}

export function useShortcuts(permissionKeys?: readonly string[]): { isOverlayOpen: boolean; closeOverlay: () => void } {
  const router = useAppRouter();
  const pathname = usePathname();
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const chordStateRef = useRef<ChordState>(IDLE_CHORD);
  const selectedRowRef = useRef(-1);
  const isOpenRef = useRef(false);
  const routerRef = useRef(router);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    isOpenRef.current = isOverlayOpen;
  }, [isOverlayOpen]);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const closeOverlay = useCallback(() => setIsOverlayOpen(false), []);
  const chordEntries = useMemo(() => bindingsForPermissions(permissionKeys), [permissionKeys]);
  const chordByKey = useMemo(
    () => new Map(chordEntries.map((entry) => [entry.key, entry])),
    [chordEntries],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      handleShortcutEvent(event, {
        navigate: (href) => routerRef.current.push(href),
        getLocale: () => extractLocale(pathnameRef.current),
        isOverlayOpen: () => isOpenRef.current,
        toggleOverlay: () => setIsOverlayOpen((open) => !open),
        chordState: chordStateRef,
        selectedRowIndex: selectedRowRef,
        chordByKey,
      });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chordByKey]);

  return { isOverlayOpen, closeOverlay };
}

function hasModifier(event: ShortcutKeyEvent): boolean {
  return event.metaKey === true || event.ctrlKey === true || event.altKey === true;
}

function moveRowSelection(direction: 1 | -1, selectedRowIndex: { current: number }): void {
  const rows = getShortcutRows();
  if (rows.length === 0) {
    selectedRowIndex.current = -1;
    return;
  }
  const next = nextRowIndex(selectedRowIndex.current, direction, rows.length);
  selectedRowIndex.current = next;
  paintRowSelection(rows, next);
  rows[next]?.scrollIntoView({ block: 'nearest' });
}

function activateSelectedRow(event: ShortcutKeyEvent, selectedRowIndex: { current: number }): void {
  if (isInteractiveTarget(event.target)) return;
  const rows = getShortcutRows();
  const index = clampRowIndex(selectedRowIndex.current, rows.length);
  const action = index >= 0 ? findPrimaryAction(rows[index]) : null;
  if (!action) return;
  event.preventDefault();
  action.click();
}

function getShortcutRows(): HTMLElement[] {
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll<HTMLElement>(`[${SHORTCUT_ROW_ATTRIBUTE}]`));
}

function paintRowSelection(rows: HTMLElement[], selectedIndex: number): void {
  rows.forEach((row, index) => {
    ROW_SELECTED_CLASSES.forEach((className) => row.classList.toggle(className, index === selectedIndex));
  });
}

function isInteractiveTarget(target: unknown): boolean {
  const element = target as { closest?: (selectors: string) => unknown } | null;
  if (!element || typeof element.closest !== 'function') return false;
  return element.closest('button, a[href], [role="button"]') !== null;
}

type ActivatableElement = { click(): void };

function findPrimaryAction(row: HTMLElement | undefined): ActivatableElement | null {
  if (!row) return null;
  const marked = row.querySelector<HTMLElement>('[data-shortcut-primary]');
  if (marked) return marked;
  const anchor = row.querySelector<HTMLAnchorElement>('a[href]');
  if (anchor) return anchor;
  return row.querySelector<HTMLButtonElement>('button:not([disabled])');
}
