'use client';

import { EmptyState } from '@/components/core/EmptyState';
import { useDictionary } from '@/hooks/useDictionary';
import type { Dictionary } from '@/lib/dictionary';

/**
 * The error boundary every People and Evaluation record tab renders.
 *
 * Why one component: a record tab failure has to offer the same retry affordance
 * in every locale, and the retry copy is part of the dictionary so the Thai
 * locale is not left with an English button.
 *
 * Why the cause stays hidden: the boundary never receives the thrown error, so a
 * failed authorization cannot be told apart from a failed read here.
 */
export function RecordTabError({ title, reset }: {
  readonly title: string;
  readonly reset: () => void;
}): React.JSX.Element {
  const retry: Dictionary['states']['retry'] = useDictionary().states.retry;
  return (
    <EmptyState
      title={title}
      description={retry.description}
      actionLabel={retry.label}
      onAction={reset}
    />
  );
}
