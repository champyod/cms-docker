'use client';

import { useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';

import { Button, type ButtonVariantInput } from '@/components/core/Button';
import { cn } from '@/lib/utils';
import { hasEffectivePermission } from '@/lib/permission-engine';
import type { Dictionary } from '@/lib/dictionary';
import type { PermissionKey } from '@/lib/permissions';

export interface RowAction {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onClick: () => void;
  readonly variant?: ButtonVariantInput;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  /**
   * The key — or keys — the action's own server gate demands, resolved here against
   * `permissionKeys`; a list means the action admits any one of them.
   *
   * Why keys and not a pre-computed flag: a boolean cannot say which permission it stands in
   * for, so a button gated on one action's flag can offer a different action. Naming the keys
   * makes the button and the gate the same value, and `ACTION_PERMISSIONS` is where those values
   * are read from by the server action too.
   */
  readonly permission?: PermissionKey | readonly PermissionKey[];
  /**
   * A display condition that is not a permission — an already-active record, a pending
   * change, a collapsed panel. Named apart from `permission` so the two cannot be conflated.
   */
  readonly showWhen?: boolean;
  /**
   * Names the action for a reader who cannot see the tooltip, so a cluster over
   * many records can read "Edit Contest 4" instead of repeating "Edit".
   */
  readonly ariaLabel?: string;
  readonly className?: string;
}

export interface RowActionsProps {
  readonly actions: readonly RowAction[];
  readonly ariaLabel: string;
  /** The caller's effective permission keys, against which every action's `permission` resolves. */
  readonly permissionKeys?: readonly string[];
  /**
   * The `RowAction.key` the j/k shortcut activates for this row.
   *
   * Why a key and not a flag on the action: `hooks/shortcut-rows` resolves the
   * marker with `querySelector`, so two flagged actions would leave the first
   * silently winning. Naming the key keeps "exactly one primary" true by
   * construction, and a key matching nothing is a contract error rather than a
   * shortcut that quietly stops reaching the row.
   */
  readonly primaryActionKey?: string;
  readonly className?: string;
}

/**
 * The record lists whose action clusters carry a group label.
 *
 * Why the type is a closed union of list types rather than a free string: a
 * cluster with no group label is announced as an unlabelled group, so the list
 * types that own one are named here and every label resolves through the
 * dictionary instead of a hand-written string at the call site.
 */
export const ROW_ACTION_GROUP_TYPES = [
  'admins',
  'contests',
  'containers',
  'groups',
  'questions',
  'tasks',
  'users',
] as const;

export type RowActionGroupType = (typeof ROW_ACTION_GROUP_TYPES)[number];

export function rowActionGroupLabel(dictionary: Dictionary, listType: RowActionGroupType): string {
  return dictionary.rowActions[listType];
}

function grantsAction(effective: ReadonlySet<string>, permission: PermissionKey | readonly PermissionKey[]): boolean {
  const keys: readonly PermissionKey[] = typeof permission === 'string' ? [permission] : permission;
  return keys.some((key) => hasEffectivePermission(effective, key));
}

function isActionVisible(action: RowAction, effective: ReadonlySet<string>): boolean {
  if (action.showWhen === false) return false;
  if (action.permission === undefined) return true;
  return grantsAction(effective, action.permission);
}

/**
 * Icon action cluster for one record row.
 *
 * Why propagation stops here: the surrounding row is itself clickable, so an
 * action click would open the record on top of running the action.
 */
export function RowActions({ actions, ariaLabel, permissionKeys, primaryActionKey, className }: RowActionsProps): React.JSX.Element | null {
  const effective = useMemo(() => new Set(permissionKeys ?? []), [permissionKeys]);
  if (primaryActionKey !== undefined && !actions.some((action) => action.key === primaryActionKey)) {
    throw new Error(`RowActions: primaryActionKey "${primaryActionKey}" matches no action`);
  }
  const visible = actions.filter((action) => isActionVisible(action, effective));
  // Why: a cluster whose every action is gated out is announced as an empty labelled
  // group, which reads to a screen reader as controls that failed to load.
  if (visible.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      onClick={(event): void => event.stopPropagation()}
      className={cn('flex items-center gap-1', className)}
    >
      {visible.map((action) => (
        <Button
          key={action.key}
          variant={action.variant ?? 'ghost'}
          size="sm"
          icon={action.icon}
          iconOnly
          tooltip={action.label}
          aria-label={action.ariaLabel ?? action.label}
          className={action.className}
          data-shortcut-primary={action.key === primaryActionKey ? true : undefined}
          disabled={action.disabled}
          loading={action.loading}
          onClick={action.onClick}
        />
      ))}
    </div>
  );
}
