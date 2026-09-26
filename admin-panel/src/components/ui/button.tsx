import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// Why the adapter vocabulary: a core wrapper maps its public variant names onto
// these, so the product API and the only class source for a button stay two
// layers apart instead of shipping a second copy of the same look.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        primaryOutline: 'border border-primary/50 bg-transparent text-primary hover:bg-primary/10',
        destructive:
          'bg-destructive text-foreground shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        destructiveOutline:
          'border border-destructive/50 bg-transparent text-destructive hover:bg-destructive/10',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-11 gap-1.5 px-3 text-sm rounded-lg',
        md: 'h-11 px-4 py-2 rounded-xl',
        lg: 'h-12 px-6 text-lg rounded-2xl',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

type ButtonRecipeProps = VariantProps<typeof buttonVariants>;

export type ButtonVariantName = NonNullable<ButtonRecipeProps['variant']>;
export type ButtonSizeName = NonNullable<ButtonRecipeProps['size']>;

function Button({
  className,
  variant,
  size,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'button'> &
  ButtonRecipeProps & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';
  const isEmpty = children === null || children === undefined;
  if (isEmpty && !asChild) {
    return (
      <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} aria-label="No action available" {...props}>
        No action available
      </Comp>
    );
  }
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {children}
    </Comp>
  );
}

export { Button, buttonVariants };
