import { Loader } from 'lucide-react';

import { EmptyState } from '@/components/core/EmptyState';
import { cn } from '@/lib/utils';

interface LoadingProps {
    text?: string;
    className?: string;
    fullScreen?: boolean;
}

export function Loading({ text = "Loading...", className, fullScreen = false }: LoadingProps) {
    const safeText = text ?? "Loading...";
    if (safeText === null || safeText === undefined) {
        return <EmptyState title="Loading" description="Content is loading" />;
    }
    if (fullScreen) {
        return (
             <div role="status" aria-live="polite" aria-busy="true" className="flex min-h-screen items-center justify-center bg-background/80 backdrop-blur-sm fixed inset-0 z-50 text-foreground">
                <div className="flex flex-col items-center gap-4">
                    <Loader className="w-8 h-8 animate-spin text-primary" aria-hidden />
                    <span className="text-lg font-medium">{safeText}</span>
                </div>
            </div>
        )
    }
    return (
        <div role="status" aria-live="polite" aria-busy="true" className={cn("flex items-center gap-2 text-muted-foreground p-4 min-h-11", className)}>
            <Loader className="w-4 h-4 animate-spin" aria-hidden />
            <span>{safeText}</span>
        </div>
    );
}
