import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export type InlineAlertTone = 'info' | 'success' | 'warning' | 'destructive';

export type InlineAlertDensity = 'default' | 'compact';

export interface InlineAlertProps {
  readonly tone: InlineAlertTone;
  /** Omit when the whole message is the body, as in the dense modal notes. */
  readonly title?: string;
  readonly children: React.ReactNode;
  readonly actions?: React.ReactNode;
  readonly className?: string;
  /**
   * Why this is not the global `density` display setting: that one is a root
   * class every component reacts to, while this picks the one scale a strip is
   * authored at, so a caller opts in per site instead of per app.
   */
  readonly density?: InlineAlertDensity;
}

interface ToneAppearance {
  readonly icon: LucideIcon;
  readonly shell: string;
  readonly compactShell: string;
  readonly accent: string;
}

interface DensityScale {
  readonly shell: string;
  readonly icon: string;
}

const TONE_APPEARANCE: Record<InlineAlertTone, ToneAppearance> = {
  info: { icon: Info, shell: 'border-info/30 bg-info/10', compactShell: 'border-info/20 bg-info/10', accent: 'text-info' },
  success: { icon: CircleCheck, shell: 'border-success/30 bg-success/10', compactShell: 'border-success/20 bg-success/10', accent: 'text-success' },
  warning: { icon: TriangleAlert, shell: 'border-warning/30 bg-warning/10', compactShell: 'border-warning/20 bg-warning/10', accent: 'text-warning' },
  destructive: { icon: CircleAlert, shell: 'border-destructive/30 bg-destructive/10', compactShell: 'border-destructive/20 bg-destructive/10', accent: 'text-destructive' },
};

const DENSITY_SCALE: Record<InlineAlertDensity, DensityScale> = {
  default: { shell: 'gap-3 p-4 text-sm', icon: 'size-5' },
  compact: { shell: 'gap-1.5 p-3 text-xs', icon: 'size-3.5' },
};

function bodyToneClass(tone: InlineAlertTone, density: InlineAlertDensity): string {
  // Why the accent only at compact: the dense notes this scale replaces colour
  // their own message, while a page-level alert keeps body copy muted so the
  // title stays the loudest thing on the card.
  return density === 'default' ? 'text-foreground/80' : TONE_APPEARANCE[tone].accent;
}

/**
 * Non-blocking strip for a message that sits inside page content.
 *
 * Why `role="alert"`: every tone here reports an outcome the reader did not
 * just cause by pressing the surrounding control, so it is announced on arrival
 * rather than sitting silently in the layout.
 */
export function InlineAlert({ tone, title, children, actions, className, density = 'default' }: InlineAlertProps): React.JSX.Element {
  const appearance = TONE_APPEARANCE[tone];
  const scale = DENSITY_SCALE[density];
  const shell = density === 'default' ? appearance.shell : appearance.compactShell;
  const Icon = appearance.icon;
  return (
    <div
      role="alert"
      className={cn('flex items-start rounded-lg border', scale.shell, shell, className)}
    >
      <Icon className={cn('mt-0.5 shrink-0', scale.icon, appearance.accent)} aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        {title !== undefined && <p className={cn('font-bold', appearance.accent)}>{title}</p>}
        <div className={bodyToneClass(tone, density)}>{children}</div>
        {actions !== undefined && (
          <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>
        )}
      </div>
    </div>
  );
}
