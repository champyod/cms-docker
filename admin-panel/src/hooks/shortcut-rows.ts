'use client';

/**
 * The `j`/`k`/`Enter` row-selection half of the shortcut layer.
 *
 * Why its own module: row selection is DOM concern, the chord is a navigation
 * concern, and `useShortcuts` is the hook that wires the two to the keyboard. One
 * file per concern keeps every one of them readable and keeps the hook itself
 * small enough to hold no more than wiring.
 */

export const SHORTCUT_ROW_ATTRIBUTE = 'data-shortcut-row';
export const ROW_SELECTED_CLASSES = ['ring-2', 'ring-ring/70', 'ring-inset', 'bg-accent/40'] as const;

export interface ShortcutRowTarget {
  readonly key: string;
  readonly target: unknown;
  preventDefault(): void;
}

export interface SelectedRowIndex {
  current: number;
}

type ActivatableElement = { click(): void };

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

export function moveRowSelection(
  direction: 1 | -1,
  selectedRowIndex: SelectedRowIndex,
): void {
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

export function activateSelectedRow(
  event: ShortcutRowTarget,
  selectedRowIndex: SelectedRowIndex,
): void {
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
    ROW_SELECTED_CLASSES.forEach((className) =>
      row.classList.toggle(className, index === selectedIndex),
    );
  });
}

function isInteractiveTarget(target: unknown): boolean {
  const element = target as { closest?: (selectors: string) => unknown } | null;
  if (!element || typeof element.closest !== 'function') return false;
  return element.closest('button, a[href], [role="button"]') !== null;
}

function findPrimaryAction(row: HTMLElement | undefined): ActivatableElement | null {
  if (!row) return null;
  const marked = row.querySelector<HTMLElement>('[data-shortcut-primary]');
  if (marked) return marked;
  const anchor = row.querySelector<HTMLAnchorElement>('a[href]');
  if (anchor) return anchor;
  return row.querySelector<HTMLButtonElement>('button:not([disabled])');
}
