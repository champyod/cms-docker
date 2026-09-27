import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export type InlineAlertTone = 'info' | 'success' | 'warning' | 'destructive';

/** `regular` is the middle of the scale: compact padding, default body size. */
export type InlineAlertDensity = 'default' | 'regular' | 'compact';

/**
 * `assertive` is `role="alert"`, `polite` is `role="status"`.
 *
 * Why the caller picks: a strip usually reports what the control the reader
 * just pressed did, and interrupting them for that is the point. A strip
 * reporting state the page merely found on arrival has nothing to interrupt,
 * so it asks for `polite` and waits its turn.
 */
export type InlineAlertAnnouncement = 'assertive' | 'polite';

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
  /**
   * Why the default is assertive: the majority of strips report the outcome of
   * the save, upload, or submit the reader just triggered, and those are worth
   * talking over the page for. A strip that instead reports what the page found
   * on arrival passes `polite`, so it reaches a screen reader when the reader
   * gets to it rather than interrupting them on every navigation.
   */
  readonly announce?: InlineAlertAnnouncement;
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
  regular: { shell: 'gap-1.5 p-3 text-sm', icon: 'size-3.5' },
  compact: { shell: 'gap-1.5 p-3 text-xs', icon: 'size-3.5' },
};

const ANNOUNCEMENT_ROLE: Record<InlineAlertAnnouncement, 'alert' | 'status'> = {
  assertive: 'alert',
  polite: 'status',
};

function bodyToneClass(tone: InlineAlertTone, density: InlineAlertDensity): string {
  // Why the accent below the top of the scale: the in-page strips this replaces
  // colour their own message, while a page-level alert keeps body copy muted so
  // the title stays the loudest thing on the card.
  return density === 'default' ? 'text-foreground/80' : TONE_APPEARANCE[tone].accent;
}

/**
 * Non-blocking strip for a message that sits inside page content.
 *
 * Why the live region is a call-site decision rather than a fixed one: a strip
 * reporting the outcome of the save, upload, or submit the reader just
 * triggered is worth announcing over the page, while a strip reporting state
 * the page found on arrival only interrupts — on every navigation, before the
 * reader has reached it. `announce` keeps the first assertive and lets the
 * second wait its turn.
 */
export function InlineAlert({ tone, title, children, actions, className, density = 'default', announce = 'assertive' }: InlineAlertProps): React.JSX.Element {
  const appearance = TONE_APPEARANCE[tone];
  const scale = DENSITY_SCALE[density];
  const shell = density === 'default' ? appearance.shell : appearance.compactShell;
  const Icon = appearance.icon;
  return (
    <div
      role={ANNOUNCEMENT_ROLE[announce]}
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
