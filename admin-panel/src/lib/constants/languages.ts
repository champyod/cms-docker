import languagesData from '@/lib/constants/languages.json';

export interface StatementLanguage {
  code: string;
  name: string;
}

export const STATEMENT_LANGUAGES: StatementLanguage[] = languagesData as StatementLanguage[];

export async function getStatementLanguages(): Promise<StatementLanguage[]> {
  return STATEMENT_LANGUAGES;
}

export function findLanguageByCode(code: string): StatementLanguage | undefined {
  return STATEMENT_LANGUAGES.find((language) => language.code === code);
}
