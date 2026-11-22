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
        return createElement('p', { className: cn('text-[length:var(--text-label)] text-muted-foreground', className) }, 'No content available');
    }
    const Component = as || (variant.startsWith('h') ? variant : 'p');

    const variants = {
        // Every variant is a token, not a Tailwind size: the scale is 12 x 1.2 (topic 2), and a
        // raw text-xl would quietly reintroduce a second ladder the gate cannot see.
        h1: "text-[length:var(--text-display)] font-semibold tracking-tight",
        h2: "text-[length:var(--text-section)] font-semibold",
        h3: "text-[length:var(--text-card)] font-medium",
        h4: "text-[length:var(--text-body)] font-semibold",
        body: "text-[length:var(--text-body)]",
        small: "text-[length:var(--text-label)]",
        muted: "text-[length:var(--text-label)] text-muted-foreground",
        label: "text-[length:var(--text-label)] font-semibold uppercase tracking-widest text-muted-foreground"
    };

    const defaultColor = color ? color : (variant === 'muted' ? '' : 'text-foreground');

    return createElement(
        Component,
        { className: cn(variants[variant], defaultColor, className), ...props },
        children
    );
}
