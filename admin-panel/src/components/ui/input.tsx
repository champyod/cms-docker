import * as React from 'react';

import { cn } from '@/lib/utils';

// Why the surface lives here: this is the only place an input's base look is
// written, so a core wrapper adds its label, icon and error policy on top
// instead of restating the field styling.
const INPUT_SURFACE =
  'flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none ' +
  'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] ' +
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input ref={ref} type={type} data-slot="input" className={cn(INPUT_SURFACE, className)} {...props} />
  )
);
Input.displayName = 'Input';

export { Input };
