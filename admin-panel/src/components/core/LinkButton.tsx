import Link from 'next/link';
import type { ReactNode } from 'react';

import { buttonVariants } from '@/components/ui/button';
import {
  BUTTON_VARIANT_TO_ADAPTER,
  resolveVariant,
  type ButtonSize,
  type ButtonVariantInput,
} from '@/components/core/Button';
import { cn } from '@/lib/utils';

export interface LinkButtonProps {
  readonly href: string;
  readonly children: ReactNode;
  readonly variant?: ButtonVariantInput;
  readonly size?: ButtonSize;
  readonly className?: string;
  /** For an icon-only link, where the glyph is the only label the eye gets. */
  readonly 'aria-label'?: string;
}

/**
 * A link that reads as one of the panel's controls.
 *
 * Some actions are navigations: they change a query parameter, they can be shared, they must work
 * before hydration and survive a middle click. Those are links, and they were being drawn as raw
 * underlined text, which the panel's own rule refuses - an underline is not a control and does not
 * sit in the same family as the buttons beside it.
 *
 * The look comes from the same variant map the Button uses, so the two cannot drift apart. There is
 * no press animation: a navigation is not a button press, and motion that suggests one is a lie.
 */
export function LinkButton({
  href,
  children,
  variant,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: LinkButtonProps): React.JSX.Element {
  // The same resolution the Button uses, so a legacy name means the same thing in both.
  const adapterVariant = BUTTON_VARIANT_TO_ADAPTER[resolveVariant(variant ?? 'secondary')];
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={cn(buttonVariants({ variant: adapterVariant, size }), 'inline-flex', className)}
    >
      {children}
    </Link>
  );
}
