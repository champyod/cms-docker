'use client';

import { createContext, useContext } from 'react';

import type { Dictionary } from '@/lib/dictionary';

export const DictionaryContext = createContext<Dictionary | undefined>(undefined);

/**
 * Translated strings for the locale the page is routed under.
 *
 * The value is the dictionary the server component already loaded — the loader itself stays on the
 * server, so no locale detection or download happens in the browser.
 */
export function useDictionary(): Dictionary {
  const dictionary = useContext(DictionaryContext);
  if (!dictionary) {
    throw new Error('useDictionary must be used within a DictionaryProvider');
  }
  return dictionary;
}
