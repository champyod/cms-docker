import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import en from '@/dictionaries/en.json';

/**
 * Renders a component that reads its copy from the dictionary provider.
 *
 * Why a helper: a component using `useDictionary` throws outside a provider, and a harness that mounts
 * it bare reports that as a component bug. One place supplies the English dictionary so a locale-aware
 * component can be tested for behaviour, not for its provider wiring.
 */
export function renderWithDictionary(ui: ReactElement): RenderResult {
  return render(<DictionaryProvider dict={en}>{ui}</DictionaryProvider>);
}
