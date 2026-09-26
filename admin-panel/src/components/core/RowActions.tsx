'use client';

import type { LucideIcon } from 'lucide-react';

import { Button, type ButtonVariantInput } from '@/components/core/Button';
import { cn } from '@/lib/utils';

export interface RowAction {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onClick: () => void;
  readonly variant?: ButtonVariantInput;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly isVisible?: boolean;
}

export interface RowActionsProps {
  readonly actions: readonly RowAction[];
  readonly ariaLabel: string;
  readonly className?: string;
}

/**
 * Icon action cluster for one record row.
 *
 * Why propagation stops here: the surrounding row is itself clickable, so an
 * action click would open the record on top of running the action.
 */
export function RowActions({ actions, ariaLabel, className }: RowActionsProps): React.JSX.Element {
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
          disabled={action.disabled}
          loading={action.loading}
          onClick={action.onClick}
        />
      ))}
    </div>
  );
}
