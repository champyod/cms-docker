import { Card } from '@/components/core/Card';
import { cn } from '@/lib/utils';

export type MetricTone = 'primary' | 'success' | 'warning' | 'destructive' | 'info';

export interface MetricCardProps {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly unit?: string;
  readonly description?: React.ReactNode;
  readonly icon?: React.ReactNode;
  readonly tone?: MetricTone;
  readonly footer?: React.ReactNode;
}

const TONE_CLASSES: Record<MetricTone, string> = {
  primary: 'text-primary bg-primary/10',
  success: 'text-success bg-success/10',
  warning: 'text-warning bg-warning/10',
  destructive: 'text-destructive bg-destructive/10',
  info: 'text-info bg-info/10',
};

/**
 * One number with its label.
 *
 * Why this is not a variant of StatusCard: a metric is read for its value and a
 * status is read for its verdict, and merging them gives each consumer a prop
 * set where only one half is meaningful.
 */
export function MetricCard({
  label,
  value,
  unit,
  description,
  icon,
  tone = 'primary',
  footer,
}: MetricCardProps): React.JSX.Element {
  return (
    <Card data-card-kind="metric" className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        {icon !== undefined && <div className={cn('rounded-xl p-3', TONE_CLASSES[tone])}>{icon}</div>}
        <div className="min-w-0">
          <div className="text-xs font-bold tracking-wider text-muted-foreground uppercase">{label}</div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-foreground">{value}</span>
            {unit !== undefined && <span className="text-sm font-medium text-muted-foreground">{unit}</span>}
          </div>
        </div>
      </div>
      {description !== undefined && <div className="text-sm text-muted-foreground">{description}</div>}
      {footer !== undefined && <div className="text-xs text-muted-foreground">{footer}</div>}
    </Card>
  );
}
