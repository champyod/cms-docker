'use client';

import { ContestTabError } from '@/components/contests/contest-detail/ContestTabError';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }): React.JSX.Element {
  return <ContestTabError title="Contest tasks could not be loaded" reset={reset} />;
}
