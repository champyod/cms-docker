'use client';

import type { ReactNode } from 'react';

import { DictionaryContext } from '@/hooks/useDictionary';
import type { Dictionary } from '@/lib/dictionary';

interface DictionaryProviderProps {
  dict: Dictionary;
  children: ReactNode;
}

/**
 * Publishes the active locale's dictionary to every client component underneath.
 *
 * Why a context rather than props: dialogs and toasts are opened from deep client components and
 * hooks (list rows, modals, persistence hooks), which are far from the page that loads the
 * dictionary. Threading the dictionary through every layer would add a prop to dozens of
 * intermediate components for text they never render.
 */
export function DictionaryProvider({
  dict,
  children,
}: DictionaryProviderProps): React.JSX.Element {
  return <DictionaryContext.Provider value={dict}>{children}</DictionaryContext.Provider>;
}
