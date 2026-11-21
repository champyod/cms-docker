'use client';

import { EmptyState } from '@/components/core/EmptyState';

export function TaskTabError({ title, reset }: { title: string; reset: () => void }): React.JSX.Element {
  return <EmptyState title={title} description="The task data could not be loaded. Retry the request." actionLabel="Retry" onAction={reset} />;
}
