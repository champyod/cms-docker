'use client';

import { Button } from '@/components/core/Button';
import { SurfaceState, type SurfaceStatus } from '@/components/core/SurfaceState';

export interface SurfaceLoadStateProps {
  readonly status: SurfaceStatus;
  /** The copy the spinner carries; the failed and denied copy already lives in the status. */
  readonly loadingTitle: string;
  readonly onRetry: () => void;
  readonly retryLabel: string;
}

/**
 * Renders what a load left behind, so no surface has to re-derive it.
 *
 * Why one component: every surface that loads on mount showed the same two states — a spinner
 * with its own title, and an alert with no way to try again — and each one spelled both out
 * again. A surface renders this whenever its status is not `idle`; `idle` means it has data.
 */
export function SurfaceLoadState({
  status,
  loadingTitle,
  onRetry,
  retryLabel,
}: SurfaceLoadStateProps): React.JSX.Element | null {
  if (status.kind === 'loading') {
    return <SurfaceState status={{ kind: 'loading', title: loadingTitle }} />;
  }
  if (status.kind === 'error') {
    return (
      <SurfaceState
        status={{
          ...status,
          action: (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {retryLabel}
            </Button>
          ),
        }}
      />
    );
  }
  return null;
}
