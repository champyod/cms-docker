'use client';

import { RecordTabError } from '@/components/shared/RecordTabError';
import { useDictionary } from '@/hooks/useDictionary';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }): React.JSX.Element {
  return <RecordTabError title={useDictionary().states.error.people} reset={reset} />;
}
