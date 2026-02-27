import { cn } from "@/lib/utils";

export function PageBackground({ className, children }: { className?: string, children?: React.ReactNode }) {
    return (
        <div className={cn("min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-neutral-900 via-black to-neutral-950 overflow-hidden relative", className)}>
             <div className="absolute top-0 left-0 w-full h-[500px] bg-indigo-600/10 blur-[120px] rounded-full pointer-events-none -translate-y-1/2 translate-x-1/2" />
             <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-cyan-600/5 blur-[100px] rounded-full pointer-events-none translate-y-1/2" />
             {children}
        </div>
    );
}

export function AuthBackground({ children }: { children: React.ReactNode }) {
    return (
         <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-slate-950 to-slate-950 -z-10" />
            {children}
        </div>
    )
}
