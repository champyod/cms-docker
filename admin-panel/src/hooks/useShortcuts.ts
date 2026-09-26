'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

import { useAppRouter } from './useAppRouter';
import { advanceChord, bindingsForPermissions, IDLE_CHORD } from './shortcut-chord';
import type { ChordEntry, ChordState } from './shortcut-chord';
import { activateSelectedRow, moveRowSelection } from './shortcut-rows';
import type { SelectedRowIndex } from './shortcut-rows';
import { buildRoute } from '@/lib/navigation/routes';

export const OVERLAY_TOGGLE_KEY = '?';

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
  selectedRowIndex: SelectedRowIndex;
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

export function handleShortcutEvent(
  event: ShortcutKeyEvent,
  deps: ShortcutHandlerDeps,
  now: number = Date.now(),
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

export function useShortcuts(permissionKeys?: readonly string[]): {
  isOverlayOpen: boolean;
  closeOverlay: () => void;
} {
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
  const chordByKey = useMemo(() => {
    const entries = bindingsForPermissions(permissionKeys);
    return new Map(entries.map((entry) => [entry.key, entry]));
  }, [permissionKeys]);

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
