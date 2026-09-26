'use client';

import type { LucideIcon } from 'lucide-react';

import { Button, type ButtonVariantInput } from '@/components/core/Button';
import { cn } from '@/lib/utils';
import type { Dictionary } from '@/lib/dictionary';

export interface RowAction {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onClick: () => void;
  readonly variant?: ButtonVariantInput;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly isVisible?: boolean;
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

/**
 * Icon action cluster for one record row.
 *
 * Why propagation stops here: the surrounding row is itself clickable, so an
 * action click would open the record on top of running the action.
 */
export function RowActions({ actions, ariaLabel, primaryActionKey, className }: RowActionsProps): React.JSX.Element {
  if (primaryActionKey !== undefined && !actions.some((action) => action.key === primaryActionKey)) {
    throw new Error(`RowActions: primaryActionKey "${primaryActionKey}" matches no action`);
  }
  const visible = actions.filter((action) => action.isVisible !== false);
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
