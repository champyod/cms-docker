/**
 * Postgres identifier rules, in a module with no imports of its own.
 *
 * Why this is separate from `restore-preview`: `restore-preview` reaches
 * `node:os` through the preview store, so anything that imports it cannot be
 * pulled into a client bundle. The conflict vocabulary is shared with the
 * panel — the confirmation popup builds the same strategy record the applier
 * consumes — so the rules it quotes with have to be reachable from both sides.
 */

/** Identifiers accepted in generated SQL; anything else is refused before it is quoted. */
export const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*$/;

export function quoteIdentifier(name: string): string {
  if (!IDENTIFIER_PATTERN.test(name)) throw new Error(`Refusing to build SQL from identifier: ${name}`);
  return `"${name}"`;
}

export function qualifiedTable(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}
