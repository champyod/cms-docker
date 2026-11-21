/**
 * The vocabulary of the board's config: what the ranking draws.
 *
 * WHY this is a module of its own rather than a second list inside ranking-override-verbs.ts:
 * the config and the override are two surfaces with two jobs — the config says what the board
 * shows, and an override is the exception that wins over it — so their vocabularies have to be
 * able to move apart without one dragging the other. A single word doing both jobs is exactly
 * what the operator asked to undo.
 */

/** The target kinds a config row can name today. Everything inside a contest comes with it. */
export const CONFIG_TARGETS = ['contest'] as const;
export type ConfigTarget = (typeof CONFIG_TARGETS)[number];

/**
 * The `target_kind` the ranking reader understands, spelled once.
 *
 * WHY the spelling is asserted in a test: the reader's `TARGET_CONTEST` and this constant are
 * the whole contract between the panel and the board, and a row written under a word the reader
 * does not know is a refusal at every route rather than a config that quietly does nothing.
 */
export const SHOWN_KIND: ConfigTarget = 'contest';

/** One shown target as the surface lists it. */
export interface ShownTarget {
  readonly id: string;
  readonly kind: string;
  readonly key: string;
  readonly reason: string;
  /** The admin who showed it, or `null` for a row written outside the panel. */
  readonly createdBy: number | null;
  /** The resolved name, or `null` when the admin row is gone; the id is still the attribution. */
  readonly createdByName: string | null;
  readonly createdAt: string;
}

/** A contest the operator can put on the board, as the picker offers it. */
export interface ShownTargetChoice {
  readonly id: number;
  readonly name: string;
}

/** The label a `target_kind` is rendered with, so the list never shows a raw wire word. */
export function isConfigTarget(value: string): value is ConfigTarget {
  return (CONFIG_TARGETS as readonly string[]).includes(value);
}
