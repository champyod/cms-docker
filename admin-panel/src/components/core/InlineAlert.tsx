import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export type InlineAlertTone = 'info' | 'success' | 'warning' | 'destructive';

export interface InlineAlertProps {
  readonly tone: InlineAlertTone;
  readonly title: string;
  readonly children: React.ReactNode;
  readonly actions?: React.ReactNode;
  readonly className?: string;
}

interface ToneAppearance {
  readonly icon: LucideIcon;
  readonly shell: string;
  readonly accent: string;
}

const TONE_APPEARANCE: Record<InlineAlertTone, ToneAppearance> = {
  info: { icon: Info, shell: 'border-info/30 bg-info/10', accent: 'text-info' },
  success: { icon: CircleCheck, shell: 'border-success/30 bg-success/10', accent: 'text-success' },
  warning: { icon: TriangleAlert, shell: 'border-warning/30 bg-warning/10', accent: 'text-warning' },
  destructive: { icon: CircleAlert, shell: 'border-destructive/30 bg-destructive/10', accent: 'text-destructive' },
};

/**
 * Non-blocking strip for a message that sits inside page content.
 *
 * Why `role="alert"`: every tone here reports an outcome the reader did not
 * just cause by pressing the surrounding control, so it is announced on arrival
 * rather than sitting silently in the layout.
 */
export function InlineAlert({ tone, title, children, actions, className }: InlineAlertProps): React.JSX.Element {
  const appearance = TONE_APPEARANCE[tone];
  const Icon = appearance.icon;
  return (
    <div
      role="alert"
      className={cn('flex items-start gap-3 rounded-lg border p-4 text-sm', appearance.shell, className)}
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', appearance.accent)} aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className={cn('font-bold', appearance.accent)}>{title}</p>
        <div className="text-foreground/80">{children}</div>
        {actions !== undefined && (
          <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>
        )}
      </div>
    </div>
  );
}
