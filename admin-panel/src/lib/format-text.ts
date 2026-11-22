/**
 * One wording for the underscore-separated enum values the database stores.
 *
 * Why a module of its own: two files defined the same function before this, one for the overview fact
 * strip and one for the settings group, so the panel had two answers to "what does `partial_credit`
 * read as" waiting to drift apart.
 */
export function humanizeEnum(value: string): string {
  return value.replace(/_/g, ' ');
}
