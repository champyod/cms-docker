import { Button } from '@/components/core/Button';
import { RotateCcw, ArrowUp, Hammer } from 'lucide-react';
import { motion } from 'motion/react';

interface StackActionButtonProps {
  label: string;
  onRestart: () => void;
  onUp: () => void;
  onBuild: () => void;
  isLoading?: boolean;
}

export function StackActionButton({ label, onRestart, onUp, onBuild, isLoading = false }: StackActionButtonProps) {
    return (
        <div className="bg-muted/30 p-3 density:p-2 rounded-xl border border-border space-y-2 min-w-0">
            <div className="text-xs font-bold text-muted-foreground truncate">{label}</div>
            <div className="flex flex-wrap gap-1">
                {/* Why: RotateCcw is globally understood for restart (80% threshold met), animated on hover/loading for feedback without text clutter */}
                <Button variant="positiveOutline" size="sm" onClick={onRestart} disabled={isLoading} className="flex-1 min-w-0" tooltip="Restart Stack" aria-label={`Restart ${label}`}>
                    <motion.span animate={isLoading ? { rotate: 360 } : { rotate: 0 }} transition={isLoading ? { repeat: Infinity, duration: 1, ease: 'linear' } : { duration: 0.3 }}>
                        <RotateCcw className="h-4 w-4 shrink-0" />
                    </motion.span>
                    <span className="hidden sm:inline">Restart</span>
                </Button>
                <Button variant="positiveOutline" size="sm" onClick={onUp} disabled={isLoading} className="flex-1 min-w-0" tooltip="Start Stack" aria-label={`Start ${label}`}>
                    <ArrowUp className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline">Up</span>
                </Button>
                <Button variant="secondary" size="sm" onClick={onBuild} disabled={isLoading} className="flex-1 min-w-0" tooltip="Build Stack" aria-label={`Build ${label}`}>
                    <Hammer className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline">Build</span>
                </Button>
            </div>
        </div>
    );
}

// Backward compatibility alias for existing imports
export { StackActionButton as StackActionBtn };
