import type en from '@/dictionaries/en.json';
import type th from '@/dictionaries/th.json';

/**
 * The shape of a complete dictionary, derived from the English file.
 *
 * Why a separate module instead of `@/i18n`: `i18n.ts` imports `server-only`, so client components
 * cannot import from it. This module is type-only (the JSON imports are erased at build time), which
 * makes it safe on both sides of the server/client boundary.
 */
export type Dictionary = typeof en;

type Parity<T extends true> = T;
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Compile-time guard: Thai may not lag behind English.
 *
 * Why: a key added to `en.json` but forgotten in `th.json` renders as `undefined` at runtime, and
 * nothing else in the panel would catch it. This alias is instantiated by the type checker, so the
 * drift fails `tsc` instead of reaching a Thai user. Extra Thai keys are structurally allowed — they
 * are harmless at runtime, and the key-set parity is measured separately.
 */
export type ThaiDictionaryMatchesEnglish = Parity<MutuallyAssignable<typeof th, Dictionary>>;
