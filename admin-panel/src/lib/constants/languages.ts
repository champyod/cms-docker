import languagesData from '@/lib/constants/languages.json';

export interface StatementLanguage {
  code: string;
  name: string;
}

export const STATEMENT_LANGUAGES: StatementLanguage[] = languagesData as StatementLanguage[];

// Why: single recognised list for both user preferred_languages and statement language validation — typos become visible.
const KNOWN_CODES = new Set(STATEMENT_LANGUAGES.map((language) => language.code.toLowerCase()));

export function normalizeLanguageCode(value: string): string {
  return value.trim().toLowerCase();
}

export function isKnownLanguageCode(value: string): boolean {
  return KNOWN_CODES.has(normalizeLanguageCode(value));
}

export async function getStatementLanguages(): Promise<StatementLanguage[]> {
  return STATEMENT_LANGUAGES;
}

export function findLanguageByCode(code: string): StatementLanguage | undefined {
  return STATEMENT_LANGUAGES.find((language) => language.code === normalizeLanguageCode(code));
}
