import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold uppercase tracking-widest',
  {
    variants: {
      variant: {
        indigo: 'border-primary/20 bg-primary/10 text-primary',
        cyan: 'border-info/20 bg-info/10 text-info',
        emerald: 'border-success/20 bg-success/10 text-success',
        amber: 'border-warning/20 bg-warning/10 text-warning',
        red: 'border-destructive/20 bg-destructive/10 text-destructive',
        neutral: 'border-border bg-secondary text-muted-foreground',
        success: 'border-success/20 bg-success/10 text-success',
        warning: 'border-warning/20 bg-warning/10 text-warning',
        info: 'border-info/20 bg-info/10 text-info',
        destructive: 'border-destructive/20 bg-destructive/10 text-destructive',
      },
    },
    defaultVariants: {
      variant: 'indigo',
    },
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'span'> & BadgeVariantProps & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span';
  const isEmpty = children === null || children === undefined || children === '';
  if (isEmpty) {
    return <Comp data-slot="badge" className={cn(badgeVariants({ variant: 'neutral' }), className)} {...props}>No value</Comp>;
  }
  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props}>
      {children}
    </Comp>
  );
}

export { Badge, badgeVariants };
export type BadgeVariantProps = VariantProps<typeof badgeVariants>;
