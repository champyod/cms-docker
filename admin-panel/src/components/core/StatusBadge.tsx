import { CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StatusType = 'ok' | 'degraded' | 'down';

interface StatusBadgeProps {
  status: StatusType;
  running?: number;
  total?: number;
}

export function StatusBadge({ status, running = 0, total = 0 }: StatusBadgeProps) {
  const variants = {
    ok: {
      label: 'Normal',
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
      textColor: 'text-green-400',
      icon: CheckCircle2,
      detail: 'All services operational'
    },
    degraded: {
      label: 'Degraded',
      color: 'text-amber-500',
      bgColor: 'bg-amber-500/10',
      textColor: 'text-amber-400',
      icon: AlertTriangle,
      detail: `${running}/${total} containers running`
    },
    down: {
      label: 'Down',
      color: 'text-red-500',
      bgColor: 'bg-red-500/10',
      textColor: 'text-red-400',
      icon: AlertCircle,
      detail: 'Services unavailable'
    }
  };

  const config = variants[status] || variants.down;
  const Icon = config.icon;

  return (
    <>
      <div className="flex justify-between items-start z-10">
        <div>
          <p className="text-sm font-medium text-neutral-400">System Status</p>
          <h3 className={cn("text-3xl font-bold mt-2", config.color)}>{config.label}</h3>
        </div>
        <div className={cn("p-2 rounded-lg", config.bgColor, config.textColor)}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className={cn("flex items-center gap-2 text-sm z-10", config.textColor)}>
        <span>{config.detail}</span>
      </div>
    </>
  );
}
