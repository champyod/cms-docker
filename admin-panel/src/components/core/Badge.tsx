import { cn } from "@/lib/utils";

interface BadgeProps {
    children: React.ReactNode;
    variant?: 'indigo' | 'cyan' | 'emerald' | 'amber' | 'red' | 'neutral';
    className?: string;
}

export function Badge({ children, variant = 'indigo', className }: BadgeProps) {
    const variants = {
        indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
        cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
        emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        red: 'bg-red-500/10 text-red-400 border-red-500/20',
        neutral: 'bg-white/5 text-neutral-400 border-white/10'
    };

    return (
        <span className={cn(
            "px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded border",
            variants[variant],
            className
        )}>
            {children}
        </span>
    );
}
