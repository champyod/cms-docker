import { useState } from 'react';

export function useSyncedState<T>(value: T) {
  const [state, setState] = useState<T>(value);
  const [prevValue, setPrevValue] = useState<T>(value);

  if (prevValue !== value) {
    setPrevValue(value);
    setState(value);
  }

  return [state, setState] as const;
}
