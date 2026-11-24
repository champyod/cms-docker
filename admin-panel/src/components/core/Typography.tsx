import { cn } from '@/lib/utils';
import { createElement, ElementType } from 'react';

interface TextProps extends React.HTMLAttributes<HTMLElement> {
    as?: ElementType;
    variant?: 'h1' | 'h2' | 'h3' | 'h4' | 'body' | 'small' | 'muted' | 'label';
    color?: string;
}

export function Text({ as, variant = 'body', className, children, color, ...props }: TextProps) {
    const isEmpty = children === null || children === undefined || children === '';
    if (isEmpty) {
        return createElement('p', { className: cn('text-xs text-muted-foreground', className) }, 'No content available');
    }
    const Component = as || (variant.startsWith('h') ? variant : 'p');

    const variants = {
        // Tokens, not Tailwind steps: one ladder, so a heading cannot disagree with the body next to it.
        h1: "text-2xl font-semibold tracking-tight",
        h2: "text-lg font-semibold",
        h3: "text-base font-medium",
        h4: "text-sm font-semibold",
        body: "text-sm",
        small: "text-xs",
        muted: "text-xs text-muted-foreground",
        label: "text-xs font-semibold uppercase tracking-widest text-muted-foreground"
    };

    const defaultColor = color ? color : (variant === 'muted' ? '' : 'text-foreground');

    return createElement(
        Component,
        { className: cn(variants[variant], defaultColor, className), ...props },
        children
    );
}
