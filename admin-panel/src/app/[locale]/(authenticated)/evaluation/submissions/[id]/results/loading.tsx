'use client';

import { Loading as LoadingState } from '@/components/core/Loading';
import { useDictionary } from '@/hooks/useDictionary';

export default function Loading(): React.JSX.Element {
  return <LoadingState text={useDictionary().states.loading.submissionResults} />;
}
