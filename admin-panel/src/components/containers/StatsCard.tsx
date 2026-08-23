import { Card } from '@/components/core/Card';
import type { LucideIcon } from 'lucide-react';

export type StatColor = 'indigo' | 'emerald' | 'red' | 'blue';

interface StatsCardProps {
  icon: LucideIcon;
  label: string;
  value: number | string;
  color: StatColor;
}

const colors: Record<StatColor, string> = {
    indigo: 'text-indigo-400 bg-indigo-400/10',
    emerald: 'text-emerald-400 bg-emerald-400/10',
    red: 'text-red-400 bg-red-400/10',
    blue: 'text-blue-400 bg-blue-400/10'
};

export function StatsCard({ icon: Icon, label, value, color }: StatsCardProps) {
    return (
        <Card className="p-4 bg-white/[0.02] border-white/5 flex items-center gap-4">
            <div className={`p-3 rounded-xl ${colors[color]}`}>
                <Icon className="w-5 h-5" />
            </div>
            <div>
                <div className="text-2xl font-bold text-white">{value}</div>
                <div className="text-xs text-neutral-500 font-bold uppercase tracking-wider">{label}</div>
            </div>
        </Card>
    );
}
