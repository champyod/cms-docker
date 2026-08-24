import { useEffect, useRef, useState } from 'react';

// Simple hook that keeps a local state in sync with incoming prop changes.
export function useSyncedState<T>(value: T) {
  const [state, setState] = useState<T>(value);
  const prevRef = useRef<T>(value);

  useEffect(() => {
    if (prevRef.current !== value) {
      prevRef.current = value;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prop-sync idiom (official adjust-during-render alternative); behavior identical
      setState(value);
    }
  }, [value]);

  return [state, setState] as const;
}
