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
        <div className="bg-muted/30 p-3 rounded-xl border border-border space-y-2">
            <div className="text-xs font-bold text-muted-foreground">{label}</div>
            <div className="flex gap-1">
                {/* Why: RotateCcw is globally understood for restart (80% threshold met), animated on hover/loading for feedback without text clutter */}
                <Button variant="positiveOutline" size="sm" onClick={onRestart} disabled={isLoading} className="flex-1" tooltip="Restart Stack" aria-label={`Restart ${label}`}>
                    <motion.span animate={isLoading ? { rotate: 360 } : { rotate: 0 }} transition={isLoading ? { repeat: Infinity, duration: 1, ease: 'linear' } : { duration: 0.3 }}>
                        <RotateCcw className="h-4 w-4" />
                    </motion.span>
                    Restart
                </Button>
                <Button variant="positiveOutline" size="sm" onClick={onUp} disabled={isLoading} className="flex-1" tooltip="Start Stack" aria-label={`Start ${label}`}>
                    <ArrowUp className="h-4 w-4" />
                    Up
                </Button>
                <Button variant="secondary" size="sm" onClick={onBuild} disabled={isLoading} className="flex-1" tooltip="Build Stack" aria-label={`Build ${label}`}>
                    <Hammer className="h-4 w-4" />
                    Build
                </Button>
            </div>
        </div>
    );
}

// Backward compatibility alias for existing imports
export { StackActionButton as StackActionBtn };
