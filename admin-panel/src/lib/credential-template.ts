/**
 * The panel's single credential generator: one alphabet builder, one random run,
 * one template renderer. Imported by client components and by `app/api` routes, so
 * it may only use the platform crypto available in both runtimes.
 */

export type CaseMode = 'both' | 'upper' | 'lower';

export interface GeneratorConfig {
  length: number;
  letters: boolean;
  caseMode: CaseMode;
  numbers: boolean;
  specials: boolean;
  operators: boolean;
}

export const MIN_GENERATOR_LENGTH = 4;
export const MAX_GENERATOR_LENGTH = 128;
export const DEFAULT_GENERATOR_LENGTH = 8;

const LETTERS_LOWER = 'abcdefghijklmnopqrstuvwxyz';
const LETTERS_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NUMBER_SYMBOLS = '0123456789';
const SPECIAL_SYMBOLS = '@#$%^&*!~';
const OPERATOR_SYMBOLS = '-+=_[]?';

/** Every character group, at the length the panel has always generated a password with. */
export const PASSWORD_CONFIG: GeneratorConfig = {
  length: DEFAULT_GENERATOR_LENGTH,
  letters: true,
  caseMode: 'both',
  numbers: true,
  specials: true,
  operators: true,
};

/** The users API accepts `[A-Za-z0-9_.-]`, so a username offers no symbol group. */
export const USERNAME_CONFIG: GeneratorConfig = {
  length: DEFAULT_GENERATOR_LENGTH,
  letters: true,
  caseMode: 'both',
  numbers: true,
  specials: false,
  operators: false,
};

function lettersFor(caseMode: CaseMode): string {
  if (caseMode === 'upper') return LETTERS_UPPER;
  if (caseMode === 'lower') return LETTERS_LOWER;
  return LETTERS_LOWER + LETTERS_UPPER;
}

export function buildCharset(config: GeneratorConfig): string {
  let charset = '';
  if (config.letters) charset += lettersFor(config.caseMode);
  if (config.numbers) charset += NUMBER_SYMBOLS;
  if (config.specials) charset += SPECIAL_SYMBOLS;
  if (config.operators) charset += OPERATOR_SYMBOLS;
  return charset;
}

/** The only characters a generated username may use; derived from USERNAME_CONFIG so the two cannot drift. */
export const USERNAME_CHARS = buildCharset(USERNAME_CONFIG);

const UINT32_RANGE = 0x100000000;

// Why rejection sampling: a bare `% bound` over-weights the charset's low
// characters whenever the 2^32 range does not divide evenly by the alphabet size.
function randomIndex(bound: number): number {
  const buffer = new Uint32Array(1);
  const limit = Math.floor(UINT32_RANGE / bound) * bound;
  let sample = UINT32_RANGE;
  while (sample >= limit) {
    crypto.getRandomValues(buffer);
    sample = buffer[0];
  }
  return sample % bound;
}

export function generateRun(config: GeneratorConfig, charset?: string): string {
  const chars = charset ?? buildCharset(config);
  if (chars.length === 0) return '';

  let run = '';
  for (let index = 0; index < config.length; index += 1) {
    run += chars[randomIndex(chars.length)];
  }
  return run;
}

const WILDCARD = '*';

/** Each `*` becomes its own run; a blank template is one full run, never an empty credential. */
export function renderTemplate(
  template: string,
  config: GeneratorConfig,
  options?: { charset?: string }
): string {
  const source = template === '' ? WILDCARD : template;
  return source.replace(/\*/g, () => generateRun(config, options?.charset));
}
