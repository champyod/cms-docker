import { Button } from '@/components/core/Button';

interface StackActionBtnProps {
  label: string;
  onRestart: () => void;
  onUp: () => void;
  onBuild: () => void;
}

export function StackActionBtn({ label, onRestart, onUp, onBuild }: StackActionBtnProps) {
    return (
        <div className="bg-muted/30 p-3 rounded-xl border border-border space-y-2">
            <div className="text-xs font-bold text-muted-foreground">{label}</div>
            <div className="flex gap-1">
                <Button variant="positiveOutline" size="sm" onClick={onRestart} className="flex-1">Restart</Button>
                <Button variant="positiveOutline" size="sm" onClick={onUp} className="flex-1">Up</Button>
                <Button variant="secondary" size="sm" onClick={onBuild} className="flex-1">Build</Button>
            </div>
        </div>
    );
}
