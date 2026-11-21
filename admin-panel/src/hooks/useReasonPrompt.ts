'use client';

import { useCallback, useState } from 'react';

export interface ReasonActionResult {
  readonly success: boolean;
  readonly error?: string;
  readonly message?: string;
}

/** One audited action the operator must justify before it runs. */
export interface ReasonAction {
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
  readonly run: (reason: string) => Promise<ReasonActionResult>;
}

export interface ReasonPrompt {
  readonly request: ReasonAction | null;
  readonly feedback: string | null;
  readonly ask: (action: ReasonAction) => void;
  readonly close: () => void;
  readonly submit: (reason: string) => Promise<ReasonActionResult>;
}

/**
 * Collects the reason for an audited action in the dialog that performs it.
 *
 * Why per-action rather than one field up front: a single reason box gating
 * every control asked for a justification before the operator had chosen what
 * to act on. The reason now arrives with the action it explains.
 */
export function useReasonPrompt(): ReasonPrompt {
  const [request, setRequest] = useState<ReasonAction | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const ask = useCallback((action: ReasonAction): void => {
    setFeedback(null);
    setRequest(action);
  }, []);

  const close = useCallback((): void => setRequest(null), []);

  const submit = useCallback(
    async (reason: string): Promise<ReasonActionResult> => {
      if (request === null) return { success: false, error: 'No action is pending' };
      const result = await request.run(reason);
      if (result.success) setFeedback(result.message ?? 'Done');
      return result;
    },
    [request],
  );

  return { request, feedback, ask, close, submit };
}
