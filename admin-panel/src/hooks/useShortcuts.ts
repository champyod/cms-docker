'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export const CHORD_TIMEOUT_MS = 1000;
export const CHORD_PREFIX_KEY = 'g';
export const OVERLAY_TOGGLE_KEY = '?';
export const SHORTCUT_ROW_ATTRIBUTE = 'data-shortcut-row';
export const ROW_SELECTED_CLASSES = ['ring-2', 'ring-ring/70', 'ring-inset', 'bg-accent/40'] as const;

export interface ShortcutRouteBinding {
  readonly key: string;
  readonly label: string;
  readonly path: string;
}

export const NAVIGATION_BINDINGS: readonly ShortcutRouteBinding[] = [
  { key: 'c', label: 'Contests', path: '/contests' },
  { key: 't', label: 'Tasks', path: '/tasks' },
  { key: 'u', label: 'Users', path: '/users' },
  { key: 'm', label: 'Teams', path: '/teams' },
  { key: 's', label: 'Submissions', path: '/submissions' },
  { key: 'd', label: 'Dashboard', path: '' },
  { key: 'e', label: 'Settings', path: '/settings' },
  { key: 'r', label: 'Resources', path: '/resources' },
  { key: 'p', label: 'Deployments', path: '/deployments' },
  { key: 'o', label: 'Containers', path: '/containers' },
];

const NAVIGATION_BY_KEY: ReadonlyMap<string, ShortcutRouteBinding> = new Map(
  NAVIGATION_BINDINGS.map((binding) => [binding.key, binding])
);

export interface ChordState {
  readonly pendingKey: string | null;
  readonly startedAt: number;
}

export type ChordDecision =
  | { readonly action: 'pending' }
  | { readonly action: 'navigate'; readonly binding: ShortcutRouteBinding }
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
}

export function extractLocale(pathname: string): string {
  return pathname.split('/')[1] || 'en';
}

export function buildLocaleHref(locale: string, path: string): string {
  return `/${locale}${path}`;
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
  now: number
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
  const binding = NAVIGATION_BY_KEY.get(key);
  if (!binding) {
    return { state: IDLE_CHORD, decision: { action: 'reset' } };
  }
  return { state: IDLE_CHORD, decision: { action: 'navigate', binding } };
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

  const result = advanceChord(deps.chordState.current, event.key, now);
  deps.chordState.current = result.state;
  if (result.decision.action === 'navigate') {
    event.preventDefault();
    deps.navigate(buildLocaleHref(deps.getLocale(), result.decision.binding.path));
  }
}

export function useShortcuts(): { isOverlayOpen: boolean; closeOverlay: () => void } {
  const router = useRouter();
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      handleShortcutEvent(event, {
        navigate: (href) => routerRef.current.push(href),
        getLocale: () => extractLocale(pathnameRef.current),
        isOverlayOpen: () => isOpenRef.current,
        toggleOverlay: () => setIsOverlayOpen((open) => !open),
        chordState: chordStateRef,
        selectedRowIndex: selectedRowRef,
      });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const closeOverlay = useCallback(() => setIsOverlayOpen(false), []);

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
