import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/core/Button';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  const safeTitle = title ?? 'No data available';
  const safeDescription = description ?? undefined;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'bg-card text-card-foreground flex flex-col items-center justify-center gap-3 rounded-xl border px-6 py-12 text-center',
        className
      )}
    >
      {Icon && (
        <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
          <Icon className="size-6" aria-hidden />
        </div>
      )}
      <p className="text-base font-semibold">{safeTitle}</p>
      {safeDescription && (
        <p className="max-w-sm text-sm text-muted-foreground">{safeDescription}</p>
      )}
      {actionLabel && onAction && (
        <Button variant="secondary" size="sm" onClick={onAction} aria-label={actionLabel}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
