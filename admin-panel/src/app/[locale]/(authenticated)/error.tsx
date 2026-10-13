'use client';

import { RecordTabError } from '@/components/shared/RecordTabError';
import { useDictionary } from '@/hooks/useDictionary';

/**
 * The authenticated shell's error boundary. Without it a throw above the module
 * boundaries — a layout failure, an unauthorized flight — bubbled past every
 * segment boundary and left the router on its loading state instead of an error.
 */
export default function AuthenticatedError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  return <RecordTabError title={useDictionary().states.error.generic} reset={reset} />;
}
