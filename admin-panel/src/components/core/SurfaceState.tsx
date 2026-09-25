import type { ReactNode } from 'react';

import { Loading } from '@/components/core/Loading';
import { Text } from '@/components/core/Typography';
import { cn } from '@/lib/utils';

export type SurfaceStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly title?: string }
  | {
      readonly kind: 'error' | 'empty' | 'not-found';
      readonly title: string;
      readonly description?: ReactNode;
      readonly action?: ReactNode;
    };

export interface SurfaceStateProps {
  readonly status?: SurfaceStatus;
  readonly className?: string;
}

export function SurfaceState({
  status = { kind: 'idle' },
  className,
}: SurfaceStateProps): React.JSX.Element | null {
  if (status.kind === 'idle') return null;
  if (status.kind === 'loading') {
    return <Loading text={status.title ?? 'Loading...'} className={cn('min-h-44', className)} />;
  }

  return (
    <div
      role={status.kind === 'error' ? 'alert' : 'status'}
      aria-live={status.kind === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'flex min-h-44 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-6 py-10 text-center',
        className,
      )}
    >
      <Text as="h2" className="text-base font-semibold">{status.title}</Text>
      {status.description && (
        <Text variant="muted" className="max-w-lg">{status.description}</Text>
      )}
      {status.action && <div className="flex flex-wrap justify-center gap-2">{status.action}</div>}
    </div>
  );
}
