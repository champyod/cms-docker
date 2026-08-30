import { CheckCircle2, AlertTriangle, AlertCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StatusType = 'ok' | 'degraded' | 'down';

export type SemanticVariant = 'success' | 'warning' | 'destructive';

interface StatusVariantConfig {
  variant: SemanticVariant;
  label: string;
  textClass: string;
  icon: LucideIcon;
  formatDetail: (running: number, total: number) => string;
}

export const STATUS_VARIANTS: Record<StatusType, StatusVariantConfig> = {
  ok: {
    variant: 'success',
    label: 'Normal',
    textClass: 'text-success',
    icon: CheckCircle2,
    formatDetail: () => 'All services operational',
  },
  degraded: {
    variant: 'warning',
    label: 'Degraded',
    textClass: 'text-warning',
    icon: AlertTriangle,
    formatDetail: (running, total) => `${running}/${total} containers running`,
  },
  down: {
    variant: 'destructive',
    label: 'Down',
    textClass: 'text-destructive',
    icon: AlertCircle,
    formatDetail: () => 'Services unavailable',
  },
};

const CHIP_CLASSES: Record<SemanticVariant, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
};

export function mapStatusToVariant(status: StatusType): StatusVariantConfig {
  return STATUS_VARIANTS[status] ?? STATUS_VARIANTS.down;
}

interface StatusBadgeProps {
  status: StatusType;
  running?: number;
  total?: number;
}

export function StatusBadge({ status, running = 0, total = 0 }: StatusBadgeProps) {
  const config = mapStatusToVariant(status);
  const Icon = config.icon;

  return (
    <>
      <div className="flex justify-between items-start z-10">
        <div>
          <p className="text-sm font-medium text-muted-foreground">System Status</p>
          <h3 className={cn("text-3xl font-bold mt-2", config.textClass)}>{config.label}</h3>
        </div>
        <div className={cn("p-2 rounded-lg", CHIP_CLASSES[config.variant])}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className={cn("flex items-center gap-2 text-sm z-10", config.textClass)}>
        <span>{config.formatDetail(running, total)}</span>
      </div>
    </>
  );
}
