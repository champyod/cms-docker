import { Loader } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoadingProps {
    text?: string;
    className?: string;
    fullScreen?: boolean;
}

export function Loading({ text = "Loading...", className, fullScreen = false }: LoadingProps) {
    if (fullScreen) {
        return (
             <div className="flex min-h-screen items-center justify-center bg-black/50 backdrop-blur-sm fixed inset-0 z-50 text-white">
                <div className="flex flex-col items-center gap-4">
                    <Loader className="w-8 h-8 animate-spin text-indigo-500" />
                    <span className="text-lg font-medium">{text}</span>
                </div>
            </div>
        )
    }
    return (
        <div className={cn("flex items-center gap-2 text-neutral-400 p-4", className)}>
            <Loader className="w-4 h-4 animate-spin" />
            <span>{text}</span>
        </div>
    );
}

export function LoadingOverlay({ text }: { text?: string }) {
     return (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px] flex items-center justify-center z-10 rounded-xl">
            <Loading text={text} className="text-white" />
        </div>
    );
}
