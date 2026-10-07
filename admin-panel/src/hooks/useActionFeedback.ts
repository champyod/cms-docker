'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';

interface ActionOutcome {
  success: boolean;
  error?: string;
}

interface FeedbackLabels {
  pending: string;
  success: string;
  failure: string;
  description?: string;
}

// One pending → success/error flow for button actions, so copy and
// toast lifecycle stay consistent instead of hand-rolled per call site.
export function useActionFeedback(): <T extends ActionOutcome>(
  labels: FeedbackLabels,
  action: () => Promise<T>,
) => Promise<T | null> {
  return useCallback(async <T extends ActionOutcome>(
    labels: FeedbackLabels,
    action: () => Promise<T>,
  ): Promise<T | null> => {
    const id = toast.loading(labels.pending);
    try {
      const result = await action();
      if (result.success) toast.success(labels.success, { id, description: labels.description });
      else toast.error(result.error ?? labels.failure, { id });
      return result;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : labels.failure, { id });
      return null;
    }
  }, []);
}
