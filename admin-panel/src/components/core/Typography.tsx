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
        return createElement('p', { className: cn('text-sm text-muted-foreground', className) }, 'No content available');
    }
    const Component = as || (variant.startsWith('h') ? variant : 'p');

    const variants = {
        h1: "text-3xl font-bold tracking-tight",
        h2: "text-xl font-semibold",
        h3: "text-lg font-medium",
        h4: "text-base font-medium",
        body: "text-base",
        small: "text-sm",
        muted: "text-sm text-muted-foreground",
        label: "text-xs font-bold uppercase tracking-widest text-muted-foreground"
    };

    const defaultColor = color ? color : (variant === 'muted' ? '' : 'text-foreground');

    return createElement(
        Component,
        { className: cn(variants[variant], defaultColor, className), ...props },
        children
    );
}
