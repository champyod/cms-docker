'use client';

import { EmptyState } from '@/components/core/EmptyState';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }): React.JSX.Element {
  return <EmptyState title="Evaluation could not be loaded" description="The data could not be loaded. Retry the request." actionLabel="Retry" onAction={reset} />;
}
