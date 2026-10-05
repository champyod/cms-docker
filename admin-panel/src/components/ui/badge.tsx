import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold uppercase tracking-widest',
  {
    variants: {
      variant: {
        indigo: 'border-primary/20 bg-primary/10 text-primary high-contrast:border-primary high-contrast:bg-primary high-contrast:text-primary-foreground',
        cyan: 'border-info/20 bg-info/10 text-info high-contrast:border-info high-contrast:bg-info high-contrast:text-info-foreground',
        emerald: 'border-success/20 bg-success/10 text-success high-contrast:border-success high-contrast:bg-success high-contrast:text-success-foreground',
        amber: 'border-warning/20 bg-warning/10 text-warning high-contrast:border-warning high-contrast:bg-warning high-contrast:text-warning-foreground',
        red: 'border-destructive/20 bg-destructive/10 text-destructive high-contrast:border-destructive high-contrast:bg-destructive high-contrast:text-destructive-foreground',
        neutral: 'border-border bg-secondary text-muted-foreground high-contrast:border-border high-contrast:bg-secondary high-contrast:text-foreground',
        success: 'border-success/20 bg-success/10 text-success high-contrast:border-success high-contrast:bg-success high-contrast:text-success-foreground',
        warning: 'border-warning/20 bg-warning/10 text-warning high-contrast:border-warning high-contrast:bg-warning high-contrast:text-warning-foreground',
        info: 'border-info/20 bg-info/10 text-info high-contrast:border-info high-contrast:bg-info high-contrast:text-info-foreground',
        destructive: 'border-destructive/20 bg-destructive/10 text-destructive high-contrast:border-destructive high-contrast:bg-destructive high-contrast:text-destructive-foreground',
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
