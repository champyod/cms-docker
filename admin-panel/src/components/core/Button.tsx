'use client';

import React from 'react';

import { Loader2, type LucideIcon } from 'lucide-react';
import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/core/Tooltip';
import { EmptyState } from '@/components/core/EmptyState';
import { buttonVariants, type ButtonVariantName } from '@/components/ui/button';
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

// Why this map is exhaustive over BUTTON_VARIANTS: a public name with no entry
// would silently fall back to the adapter default, so a renamed product variant
// has to be given an adapter name here or fail to type-check.
export const BUTTON_VARIANT_TO_ADAPTER: Record<ButtonVariant, ButtonVariantName> = {
  positive: 'default',
  positiveOutline: 'primaryOutline',
  negative: 'destructive',
  negativeOutline: 'destructiveOutline',
  secondary: 'secondary',
  ghost: 'ghost',
  link: 'link',
};

export function resolveVariant(variant?: ButtonVariantInput): ButtonVariant {
  if (!variant) return 'positive';
  if (variant === 'primary') return LEGACY_VARIANT_MAP.primary;
  if (variant === 'danger') return LEGACY_VARIANT_MAP.danger;
  return variant;
}

const ICON_ONLY_SIZE: Record<ButtonSize, string> = {
  sm: 'h-11 w-11 p-0',
  md: 'h-11 w-11 p-0',
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

function getIconOnlyState(
  children: React.ReactNode,
  icon: LucideIcon | undefined,
  iconOnly: boolean | undefined
): { hasChildren: boolean; isIconOnly: boolean } {
  const hasChildren = children !== null && children !== undefined;
  return { hasChildren, isIconOnly: iconOnly ?? Boolean(icon && !hasChildren) };
}

function getAriaLabel(
  isIconOnly: boolean,
  tooltip: string | undefined,
  children: React.ReactNode
): string | undefined {
  if (!isIconOnly) return undefined;
  if (tooltip) return tooltip;
  return typeof children === 'string' ? children : undefined;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size = 'md', loading, icon, iconOnly, tooltip, children, disabled, type = 'button', ...props },
    ref
  ) => {
    const resolvedVariant = resolveVariant(variant);
    const { hasChildren, isIconOnly } = getIconOnlyState(children, icon, iconOnly);
    // Why the hook rather than a stylesheet: the hover and tap transforms are
    // motion values, so a `prefers-reduced-motion` rule cannot reach them.
    const shouldReduceMotion = useReducedMotion() === true;
    if (process.env.NODE_ENV !== 'production' && isIconOnly && !tooltip) {
      console.warn('Button: iconOnly requires a `tooltip` prop for accessibility.');
    }
    if (!hasChildren && !icon && !loading) {
      return <EmptyState title="No action available" description="Button content is empty" />;
    }
    const ariaLabel = getAriaLabel(isIconOnly, tooltip, children);
    const button = (
      <motion.button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-label={ariaLabel}
        aria-busy={loading || undefined}
        whileHover={shouldReduceMotion ? undefined : { scale: 1.02, filter: 'brightness(1.05)' }}
        whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className={cn(buttonVariants({ variant: BUTTON_VARIANT_TO_ADAPTER[resolvedVariant], size }), isIconOnly && ICON_ONLY_SIZE[size], className)}
        {...props}
      >
        <LeadingIcon icon={icon} loading={loading} />
        {children}
      </motion.button>
    );
    if (isIconOnly && tooltip) return <TooltipShell label={tooltip}>{button}</TooltipShell>;
    return button;
  }
);

Button.displayName = 'Button';
