'use client';

import React from 'react';
import { cva } from 'class-variance-authority';
import { motion, type HTMLMotionProps } from 'motion/react';
import { Loader2, type LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export const BUTTON_VARIANTS = [
  'positive',
  'positiveOutline',
  'negative',
  'negativeOutline',
  'secondary',
  'ghost',
  'link',
] as const;

export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];
export type LegacyButtonVariant = 'primary' | 'danger';
export type ButtonVariantInput = ButtonVariant | LegacyButtonVariant;
export type ButtonSize = 'sm' | 'md' | 'lg';

export const LEGACY_VARIANT_MAP: Record<LegacyButtonVariant, ButtonVariant> = {
  primary: 'positive',
  danger: 'negative',
};

export function resolveVariant(variant?: ButtonVariantInput): ButtonVariant {
  if (!variant) return 'positive';
  if (variant === 'primary') return LEGACY_VARIANT_MAP.primary;
  if (variant === 'danger') return LEGACY_VARIANT_MAP.danger;
  return variant;
}

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        positive: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        positiveOutline: 'border border-primary/50 bg-transparent text-primary hover:bg-primary/10',
        negative:
          'bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        negativeOutline:
          'border border-destructive/50 bg-transparent text-destructive hover:bg-destructive/10',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 gap-1.5 px-3 text-sm rounded-lg',
        md: 'h-10 px-4 py-2 rounded-xl',
        lg: 'h-12 px-6 text-lg rounded-2xl',
      },
    },
    defaultVariants: {
      variant: 'positive',
      size: 'md',
    },
  }
);

const ICON_ONLY_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 w-8 p-0',
  md: 'h-10 w-10 p-0',
  lg: 'h-12 w-12 p-0',
};

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children?: React.ReactNode;
  variant?: ButtonVariantInput;
  size?: ButtonSize;
  loading?: boolean;
  icon?: LucideIcon;
  iconOnly?: boolean;
  tooltip?: string;
}

function LeadingIcon({ icon, loading }: { icon?: LucideIcon; loading?: boolean }) {
  if (loading) return <Loader2 className="size-4 animate-spin" aria-hidden />;
  if (!icon) return null;
  const Icon = icon;
  return <Icon className="size-4 shrink-0" aria-hidden />;
}

function TooltipShell({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size = 'md', loading, icon, iconOnly, tooltip, children, disabled, type = 'button', ...props },
    ref
  ) => {
    const resolvedVariant = resolveVariant(variant);
    const hasChildren = children !== null && children !== undefined;
    const isIconOnly = iconOnly ?? Boolean(icon && !hasChildren);

    if (process.env.NODE_ENV !== 'production' && isIconOnly && !tooltip) {
      console.warn('Button: iconOnly requires a `tooltip` prop for accessibility.');
    }

    const ariaLabel = isIconOnly ? tooltip ?? (typeof children === 'string' ? children : undefined) : undefined;

    const button = (
      <motion.button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-label={ariaLabel}
        aria-busy={loading || undefined}
        whileHover={{ scale: 1.02, filter: 'brightness(1.05)' }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className={cn(buttonVariants({ variant: resolvedVariant, size }), isIconOnly && ICON_ONLY_SIZE[size], className)}
        {...props}
      >
        <LeadingIcon icon={icon} loading={loading} />
        {children}
      </motion.button>
    );

    if (isIconOnly && tooltip) {
      return <TooltipShell label={tooltip}>{button}</TooltipShell>;
    }
    return button;
  }
);

Button.displayName = 'Button';
