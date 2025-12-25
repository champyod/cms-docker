import 'server-only';

const dictionaries = {
  en: () => import('./dictionaries/en.json').then((module) => module.default),
  th: () => import('./dictionaries/th.json').then((module) => module.default),
};

export const getDictionary = async (locale: string) => {
  if (dictionaries[locale as keyof typeof dictionaries]) {
    return dictionaries[locale as keyof typeof dictionaries]();
  }
  return dictionaries['en']();
};
