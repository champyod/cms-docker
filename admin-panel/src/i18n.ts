import 'server-only';

import type { Dictionary } from '@/lib/dictionary';

const dictionaries = {
  en: () => import('./dictionaries/en.json').then((module) => module.default),
  th: () => import('./dictionaries/th.json').then((module) => module.default),
};

// Why annotated: this is where a key added to en.json but missing from th.json breaks the build.
export const getDictionary = async (locale: string): Promise<Dictionary> => {
  if (dictionaries[locale as keyof typeof dictionaries]) {
    return dictionaries[locale as keyof typeof dictionaries]();
  }
  return dictionaries['en']();
};
