/** Grouping is a property of the number, not of the page that shows it. */
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

/** One place for count-and-noun; a language without plurals passes the same word twice. */
export function countLabel(count: number, noun: { one: string; other: string }, locale?: string): string {
  return `${formatCount(count, locale)} ${count === 1 ? noun.one : noun.other}`;
}

/** A score's precision belongs to the task, not to the page that shows it. */
export function formatScore(value: number, precision: number, locale?: string): string {
  if (!Number.isFinite(value)) return String(value);
  try {
    return new Intl.NumberFormat(locale ?? 'en', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    }).format(value);
  } catch {
    return value.toFixed(precision);
  }
}
