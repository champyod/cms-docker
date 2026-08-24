import { Card } from '@/components/core/Card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

export type StatColor = 'primary' | 'success' | 'destructive' | 'info';

interface StatsCardProps {
  icon: LucideIcon;
  label: string;
  value: number | string;
  color: StatColor;
}

const colors: Record<StatColor, string> = {
    primary: 'text-primary bg-primary/10',
    success: 'text-success bg-success/10',
    destructive: 'text-destructive bg-destructive/10',
    info: 'text-info bg-info/10'
};

export function StatsCard({ icon: Icon, label, value, color }: StatsCardProps) {
    return (
        <Card className="p-4 flex items-center gap-4">
            <div className={cn('p-3 rounded-xl', colors[color])}>
                <Icon className="w-5 h-5" />
            </div>
            <div>
                <div className="text-2xl font-bold text-foreground">{value}</div>
                <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider">{label}</div>
            </div>
        </Card>
    );
}
