/**
 * One way to print a count.
 *
 * The panel had no number formatting at all, so a metric of 1204 read as "1204" while every other
 * number in the product was grouped. Grouping is a property of the number, not of the page that
 * shows it, so it lives here rather than being retyped per surface.
 */
export function formatCount(value: number, locale?: string): string {
  if (!Number.isFinite(value)) return String(value);
  try {
    return new Intl.NumberFormat(locale ?? 'en', { maximumFractionDigits: 0 }).format(value);
  } catch {
    // An unknown locale must not break a page over a comma.
    return String(value);
  }
}

/** A count that is already text (a state name, a ratio) is printed as given. */
export function formatCountOrText(value: number | string, locale?: string): string {
  return typeof value === 'number' ? formatCount(value, locale) : value;
}

/**
 * A count with its noun, singular or plural, in the reader's locale.
 *
 * Why here: the panel hand-rolled the same `count === 1 ? 'task' : 'tasks'` in five places, each free
 * to disagree with the others. A language without plurals passes the same word twice.
 */
export function countLabel(count: number, noun: { one: string; other: string }, locale?: string): string {
  return `${formatCount(count, locale)} ${count === 1 ? noun.one : noun.other}`;
}
