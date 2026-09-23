'use client';

export type StatusTone = 'emerald' | 'amber' | 'blue' | 'red';

/** Single tone map for every connection/service/worker status in the panel. */
export function statusTone(status: string): StatusTone {
  switch (status) {
    case 'healthy':
    case 'running':
    case 'online':
      return 'emerald';
    case 'busy':
    case 'unhealthy':
      return 'amber';
    case 'starting':
      return 'blue';
    case 'stopped':
    default:
      return 'red';
  }
}

const DOT_TONE: Record<StatusTone, string> = {
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  blue: 'bg-blue-500',
  red: 'bg-red-500',
};

const TEXT_TONE: Record<StatusTone, string> = {
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  blue: 'text-blue-400',
  red: 'text-red-400',
};

/** One dot plus label for a status string; the only status renderer. */
export function StatusPill({ status, className }: { status: string; className?: string }): React.JSX.Element {
  const tone = statusTone(status);
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <span className={`w-2 h-2 rounded-full fill-current ${DOT_TONE[tone]}`} />
      <span className={`font-medium text-xs uppercase ${TEXT_TONE[tone]}`}>{status.toUpperCase()}</span>
    </span>
  );
}
